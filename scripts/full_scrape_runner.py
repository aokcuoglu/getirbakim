#!/usr/bin/env python3
"""Orchestrate full ptproducts scrape: approved dbrands_match brands first, then rest."""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR / "scripts"))

import parcatedarik_scraper as scraper_mod  # noqa: E402
from parcatedarik_scraper import (  # noqa: E402
    BASE_URL,
    get_brand_by_url_key,
    get_db_connection,
    get_db_product_count_for_url_key,
    get_site_product_count,
    setup_session,
    scrape_manufacturer,
    upload_brand_images_only,
)

RESULT_RE = re.compile(
    r"Sonuç:\s*(\d+)\s*yeni ürün,\s*(\d+)\s*güncelleme"
)
IMAGE_RE = re.compile(
    r"Görseller:\s*uploaded=(\d+)\s*skipped=(\d+)\s*failed=(\d+)\s*no_source=(\d+)"
)
IMAGE_UPDATE_RE = re.compile(r"Sonuç:\s*(\d+)\s*görsel URL güncellendi")
BRAND_HEADER_RE = re.compile(
    r"\[\d+/\d+\] Brand: .+ \(([a-z0-9_-]+)\)"
)
PIPELINE_METADATA_DONE_RE = re.compile(r"\[metadata done\] ([A-Z0-9_-]+)")
PIPELINE_IMAGES_STARTED_RE = re.compile(r"\[images started\] ([A-Z0-9_-]+)")
PIPELINE_IMAGES_DONE_RE = re.compile(r"\[images done\] ([A-Z0-9_-]+)")


class Tee:
    def __init__(self, *streams):
        self.streams = streams
        self._lock = threading.Lock()

    def write(self, data):
        with self._lock:
            for s in self.streams:
                s.write(data)
                s.flush()

    def flush(self):
        with self._lock:
            for s in self.streams:
                s.flush()


def ordered_url_keys(conn) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT pb.url_key
            FROM v0.dbrands_match dm
            JOIN v0.ptbrands pb ON pb.id = dm.ptbrands_id
            WHERE dm.mapping_status = 'APPROVED'
              AND dm.dbrands_id IS NOT NULL
              AND dm.ptbrands_id IS NOT NULL
              AND pb.url_key IS NOT NULL
            ORDER BY pb.url_key
            """
        )
        approved = [r[0] for r in cur.fetchall()]
        cur.execute(
            'SELECT url_key FROM "v0"."ptbrands" WHERE url_key IS NOT NULL ORDER BY url_key'
        )
        all_keys = [r[0] for r in cur.fetchall()]
    approved_set = set(approved)
    remaining = [k for k in all_keys if k not in approved_set]
    return approved + remaining


def load_completed_url_keys(summary_path: Path) -> set[str]:
    if not summary_path.exists():
        return set()
    try:
        data = json.loads(summary_path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    completed = set()
    for brand in data.get("brands", []):
        if brand.get("status") == "ok":
            if brand.get("metadata_status") == "ok" and brand.get("images_status") == "ok":
                completed.add(brand["url_key"])
            elif (
                brand.get("metadata_status") is None
                and brand.get("images_status") is None
                and brand.get("phase") in (None, "pipeline", "both")
            ):
                completed.add(brand["url_key"])
    return completed


def parse_log_progress(log_path: Path) -> tuple[set[str], set[str]]:
    """Return (metadata_done, images_done) url_key sets from a prior run log."""
    if not log_path.exists():
        return set(), set()
    metadata_done: set[str] = set()
    images_done: set[str] = set()
    current_brand: str | None = None
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return set(), set()

    for line in text.splitlines():
        m = PIPELINE_METADATA_DONE_RE.search(line)
        if m:
            metadata_done.add(m.group(1).lower())
            continue
        m = PIPELINE_IMAGES_DONE_RE.search(line)
        if m:
            images_done.add(m.group(1).lower())
            continue
        m = PIPELINE_IMAGES_STARTED_RE.search(line)
        if m:
            continue
        m = BRAND_HEADER_RE.search(line)
        if m:
            current_brand = m.group(1).lower()
            continue
        if current_brand and RESULT_RE.search(line):
            metadata_done.add(current_brand)
            continue

    # Pipeline logs interleave image job output; rely on [images done] markers only.
    metadata_done |= images_done
    return metadata_done, images_done


def parse_brand_output(text: str, *, images_only: bool = False) -> dict:
    out = {
        "inserted": 0,
        "updated": 0,
        "images_uploaded": 0,
        "images_skipped": 0,
        "images_failed": 0,
        "images_no_source": 0,
        "images_url_updated": 0,
    }
    if images_only:
        m = IMAGE_UPDATE_RE.search(text)
        if m:
            out["images_url_updated"] = int(m.group(1))
    else:
        m = RESULT_RE.search(text)
        if m:
            out["inserted"] = int(m.group(1))
            out["updated"] = int(m.group(2))
    m = IMAGE_RE.search(text)
    if m:
        out["images_uploaded"] = int(m.group(1))
        out["images_skipped"] = int(m.group(2))
        out["images_failed"] = int(m.group(3))
        out["images_no_source"] = int(m.group(4))
    return out


def run_brand(
    *,
    tee,
    conn,
    session,
    brand_info,
    phase: str,
    workers: int,
    dry_run: bool,
) -> tuple[str, dict]:
    import io

    capture_buf = io.StringIO()

    class Capture:
        def write(self, data):
            capture_buf.write(data)
            tee.write(data)

        def flush(self):
            tee.flush()

    old_stdout = sys.stdout
    sys.stdout = Capture()
    try:
        target = {
            "name": brand_info["name"],
            "url": f"{BASE_URL}/{brand_info['url_key']}",
        }

        if phase != "images":
            url_key = brand_info["url_key"]
            db_count = get_db_product_count_for_url_key(conn, url_key)
            if db_count > 0:
                site_count = get_site_product_count(session, target["url"])
                if site_count is not None and db_count == site_count:
                    print(f"  ATLANDI (sayı eşleşmesi): DB={db_count}, Site={site_count}")
                    return "ok", {
                        "inserted": 0, "updated": 0,
                        "images_uploaded": 0, "images_skipped": 0,
                        "images_failed": 0, "images_no_source": 0,
                        "images_url_updated": 0,
                    }

        if phase == "images":
            upload_brand_images_only(
                session,
                conn,
                target,
                workers=workers,
                dry_run=dry_run,
            )
            stats = parse_brand_output(capture_buf.getvalue(), images_only=True)
        elif phase == "metadata":
            scrape_manufacturer(
                session,
                conn,
                PROJECT_DIR,
                target,
                full_rescan=True,
                proxy_rotator=None,
                dry_run=dry_run,
                upload_images=False,
                workers=workers,
            )
            stats = parse_brand_output(capture_buf.getvalue())
        else:
            scrape_manufacturer(
                session,
                conn,
                PROJECT_DIR,
                target,
                full_rescan=True,
                proxy_rotator=None,
                dry_run=dry_run,
                upload_images=(phase == "both"),
                workers=workers,
            )
            stats = parse_brand_output(capture_buf.getvalue())
        return "ok", stats
    except Exception as e:
        err = str(e)
        print(f"BRAND FAILED ({brand_info['url_key']}): {err}")
        traceback.print_exc()
        return "failed", {"error": err}
    finally:
        sys.stdout = old_stdout


def run_image_job_background(
    *,
    tee,
    brand_info: dict,
    workers: int,
    dry_run: bool,
) -> tuple[str, dict]:
    conn = get_db_connection()
    session = setup_session(proxy=None)
    try:
        return run_brand(
            tee=tee,
            conn=conn,
            session=session,
            brand_info=brand_info,
            phase="images",
            workers=workers,
            dry_run=dry_run,
        )
    finally:
        try:
            conn.close()
        except Exception:
            pass


def merge_brand_stats(existing: dict, stats: dict) -> None:
    for k in (
        "inserted",
        "updated",
        "images_uploaded",
        "images_skipped",
        "images_failed",
        "images_no_source",
        "images_url_updated",
    ):
        existing[k] = existing.get(k, 0) + stats.get(k, 0)


def run_images_parallel(
    *,
    tee,
    url_keys: list[str],
    workers: int,
    dry_run: bool,
    image_jobs: int,
    images_done: set[str],
    totals: dict,
    brand_results: list[dict],
    failed_brands: list[dict],
) -> None:
    """Upload images for multiple brands concurrently (catch-up pass)."""
    conn = get_db_connection()
    try:
        to_process: list[tuple[int, str, dict]] = []
        for i, url_key in enumerate(url_keys, start=1):
            if url_key in images_done:
                tee.write(f"\n[{i}/{len(url_keys)}] SKIP — {url_key} (images done)\n")
                totals["brands_ok"] += 1
                brand_results.append(
                    {
                        "url_key": url_key,
                        "status": "ok",
                        "images_status": "ok",
                        "resumed": True,
                    }
                )
                continue
            brand_info = get_brand_by_url_key(conn, url_key)
            if not brand_info:
                msg = f"url_key not found: {url_key}"
                tee.write(f"\n[{i}/{len(url_keys)}] SKIP — {msg}\n")
                failed_brands.append({"url_key": url_key, "error": msg})
                totals["brands_failed"] += 1
                brand_results.append(
                    {"url_key": url_key, "status": "missing", "error": msg}
                )
                continue
            to_process.append((i, url_key, brand_info))

        if not to_process:
            tee.write("\nNo brands queued for image catch-up.\n")
            return

        tee.write(
            f"\nImage catch-up: {len(to_process)} brand(s), "
            f"{image_jobs} concurrent job(s), {workers} worker(s)/brand\n"
        )

        def _run_one(_i: int, brand_info: dict) -> tuple[str, str, dict]:
            uk = brand_info["url_key"]
            tee.write(
                f"\n[{_i}/{len(url_keys)}] Brand: {brand_info['name']} ({uk}) "
                f"[phase=images catch-up]\n"
            )
            status, stats = run_image_job_background(
                tee=tee,
                brand_info=brand_info,
                workers=workers,
                dry_run=dry_run,
            )
            return uk, status, stats

        with ThreadPoolExecutor(max_workers=max(1, image_jobs)) as executor:
            futures = [
                (i, uk, bi, executor.submit(_run_one, i, bi))
                for i, uk, bi in to_process
            ]
            for i, uk, bi, future in futures:
                try:
                    _uk, status, stats = future.result()
                except Exception as e:
                    status, stats = "failed", {"error": str(e)}
                    tee.write(f"BRAND FAILED ({uk}) [images catch-up]: {e}\n")
                    traceback.print_exc()

                if status == "ok":
                    totals["brands_ok"] += 1
                    for k in (
                        "images_uploaded",
                        "images_skipped",
                        "images_failed",
                        "images_no_source",
                        "images_url_updated",
                    ):
                        totals[k] += stats.get(k, 0)
                    brand_results.append(
                        {
                            "url_key": uk,
                            "name": bi["name"],
                            "phase": "images",
                            "status": "ok",
                            **stats,
                        }
                    )
                else:
                    totals["brands_failed"] += 1
                    failed_brands.append(
                        {
                            "url_key": uk,
                            "name": bi["name"],
                            "phase": "images",
                            "error": stats.get("error", "unknown"),
                        }
                    )
                    brand_results.append(
                        {
                            "url_key": uk,
                            "name": bi["name"],
                            "phase": "images",
                            "status": "failed",
                            "error": stats.get("error", "unknown"),
                        }
                    )
    finally:
        conn.close()


def run_pipeline(
    *,
    tee,
    conn,
    session,
    url_keys: list[str],
    workers: int,
    dry_run: bool,
    image_jobs: int,
    metadata_done: set[str],
    images_done: set[str],
    skip_keys: set[str],
    totals: dict,
    brand_results: list[dict],
    failed_brands: list[dict],
    skip_resumed_images: bool = False,
) -> None:
    brand_state: dict[str, dict] = {}
    pending: list[tuple[str, dict, Future]] = []
    state_lock = threading.Lock()

    def submit_images(brand_info: dict) -> None:
        url_key = brand_info["url_key"]
        if url_key in images_done or dry_run:
            tee.write(f"[images done] {url_key.upper()} (skipped — already done or dry-run)\n")
            entry = brand_state.setdefault(
                url_key,
                {
                    "url_key": url_key,
                    "name": brand_info["name"],
                    "metadata_status": "ok",
                    "images_status": "ok",
                    "status": "ok",
                },
            )
            entry["images_status"] = "ok"
            entry["status"] = "ok" if entry.get("metadata_status") == "ok" else entry.get("status")
            return

        tee.write(f"[images started] {url_key.upper()}\n")

        def _done_callback(fut: Future, *, uk=url_key, bi=brand_info) -> None:
            try:
                status, stats = fut.result()
            except Exception as e:
                status, stats = "failed", {"error": str(e)}
                tee.write(f"BRAND FAILED ({uk}) [images]: {e}\n")
                traceback.print_exc()

            label = uk.upper()
            with state_lock:
                if status == "ok":
                    tee.write(f"[images done] {label}\n")
                    entry = brand_state.setdefault(
                        uk,
                        {
                            "url_key": uk,
                            "name": bi["name"],
                            "metadata_status": "ok",
                            "images_status": "pending",
                            "status": "pending",
                        },
                    )
                    entry["images_status"] = "ok"
                    merge_brand_stats(entry, stats)
                    if entry.get("metadata_status") == "ok":
                        entry["status"] = "ok"
                        totals["brands_ok"] += 1
                    for k in (
                        "inserted",
                        "updated",
                        "images_uploaded",
                        "images_skipped",
                        "images_failed",
                        "images_no_source",
                        "images_url_updated",
                    ):
                        totals[k] += stats.get(k, 0)
                else:
                    tee.write(f"[images failed] {label}: {stats.get('error', 'unknown')}\n")
                    totals["brands_failed"] += 1
                    failed_brands.append(
                        {
                            "url_key": uk,
                            "name": bi["name"],
                            "phase": "images",
                            "error": stats.get("error", "unknown"),
                        }
                    )
                    brand_state[uk] = {
                        "url_key": uk,
                        "name": bi["name"],
                        "metadata_status": brand_state.get(uk, {}).get(
                            "metadata_status", "ok"
                        ),
                        "images_status": "failed",
                        "status": "failed",
                        "error": stats.get("error", "unknown"),
                    }

        future = image_executor.submit(
            run_image_job_background,
            tee=tee,
            brand_info=brand_info,
            workers=workers,
            dry_run=dry_run,
        )
        future.add_done_callback(_done_callback)
        pending.append((url_key, brand_info, future))

    with ThreadPoolExecutor(max_workers=image_jobs) as image_executor:
        for i, url_key in enumerate(url_keys, start=1):
            if url_key in skip_keys:
                continue
            if url_key in metadata_done and url_key in images_done:
                tee.write(f"\n[{i}/{len(url_keys)}] SKIP — {url_key} (metadata + images done)\n")
                totals["brands_ok"] += 1
                brand_results.append(
                    {
                        "url_key": url_key,
                        "status": "ok",
                        "metadata_status": "ok",
                        "images_status": "ok",
                        "resumed": True,
                    }
                )
                continue

            brand_info = get_brand_by_url_key(conn, url_key)
            if not brand_info:
                msg = f"url_key not found: {url_key}"
                tee.write(f"\n[{i}/{len(url_keys)}] SKIP — {msg}\n")
                failed_brands.append({"url_key": url_key, "error": msg})
                totals["brands_failed"] += 1
                brand_results.append(
                    {"url_key": url_key, "status": "missing", "error": msg}
                )
                continue

            metadata_already = url_key in metadata_done

            if metadata_already:
                tee.write(
                    f"\n[{i}/{len(url_keys)}] Brand: {brand_info['name']} ({url_key}) "
                    f"[resume: metadata done, images pending]\n"
                )
                brand_state[url_key] = {
                    "url_key": url_key,
                    "name": brand_info["name"],
                    "metadata_status": "ok",
                    "images_status": "pending" if not skip_resumed_images else "deferred",
                    "status": "pending" if not skip_resumed_images else "ok",
                    "resumed_metadata": True,
                }
                if skip_resumed_images:
                    tee.write(
                        f"  [images deferred — catch-up pass handles {url_key}]\n"
                    )
                    totals["brands_ok"] += 1
                else:
                    submit_images(brand_info)
                continue

            tee.write(
                f"\n[{i}/{len(url_keys)}] Brand: {brand_info['name']} ({url_key}) "
                f"[phase=pipeline]\n"
            )

            status, stats = run_brand(
                tee=tee,
                conn=conn,
                session=session,
                brand_info=brand_info,
                phase="metadata",
                workers=workers,
                dry_run=dry_run,
            )

            if status == "failed":
                totals["brands_failed"] += 1
                failed_brands.append(
                    {
                        "url_key": url_key,
                        "name": brand_info["name"],
                        "phase": "metadata",
                        "error": stats.get("error", "unknown"),
                    }
                )
                brand_state[url_key] = {
                    "url_key": url_key,
                    "name": brand_info["name"],
                    "metadata_status": "failed",
                    "images_status": "skipped",
                    "status": "failed",
                    "error": stats.get("error", "unknown"),
                }
                try:
                    if conn.closed:
                        conn = get_db_connection()
                    else:
                        conn.rollback()
                except Exception:
                    conn = get_db_connection()
                time.sleep(5)
                continue

            tee.write(f"[metadata done] {url_key.upper()}\n")
            brand_state[url_key] = {
                "url_key": url_key,
                "name": brand_info["name"],
                "metadata_status": "ok",
                "images_status": "pending",
                "status": "pending",
                **stats,
            }
            for k in ("inserted", "updated"):
                totals[k] += stats.get(k, 0)

            submit_images(brand_info)

        tee.write("\n" + "=" * 60 + "\n")
        tee.write(f"All metadata queued; waiting for {len(pending)} image job(s)...\n")
        tee.write("=" * 60 + "\n")

        for _url_key, _brand_info, future in pending:
            future.result()

    brand_results.extend(brand_state.values())


def main() -> int:
    parser = argparse.ArgumentParser(description="Full ptproducts scrape orchestrator")
    parser.add_argument(
        "--phase",
        choices=["metadata", "images", "both", "pipeline"],
        default="both",
        help=(
            "metadata=sku/price only; images=Supabase upload pass; "
            "both=sequential metadata then images; pipeline=metadata then bg images per brand"
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Parallel image download/upload workers per brand (default: 6)",
    )
    parser.add_argument(
        "--image-jobs",
        type=int,
        default=2,
        help="Concurrent brand-level image upload jobs in pipeline mode (default: 2)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between page fetches in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--resume-summary",
        type=str,
        help="Skip brands marked ok in a prior summary JSON",
    )
    parser.add_argument(
        "--resume-log",
        type=str,
        help="Parse a prior log to resume metadata/images progress (pipeline mode)",
    )
    parser.add_argument(
        "--only-metadata-done",
        action="store_true",
        help=(
            "With --resume-log and --phase images: only upload images for brands "
            "whose metadata already completed in the log"
        ),
    )
    parser.add_argument(
        "--brands",
        type=str,
        help="Comma-separated url_keys to process (default: full ordered list)",
    )
    parser.add_argument(
        "--log-prefix",
        type=str,
        default="full-scrape",
        help="Log/summary filename prefix (default: full-scrape)",
    )
    parser.add_argument(
        "--skip-resumed-images",
        action="store_true",
        help=(
            "Pipeline mode: skip image upload for metadata-done brands from --resume-log "
            "(use with a separate image catch-up pass)"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without DB writes or uploads",
    )
    args = parser.parse_args()

    scraper_mod.REQUEST_DELAY = args.delay

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = PROJECT_DIR / "scripts" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    log_prefix = args.log_prefix.strip() or "full-scrape"
    log_path = output_dir / f"{log_prefix}-{ts}.log"
    summary_path = output_dir / f"{log_prefix}-{ts}-summary.json"

    started_at = datetime.now(timezone.utc).isoformat()
    t0 = time.time()

    skip_keys: set[str] = set()
    if args.resume_summary:
        skip_keys = load_completed_url_keys(Path(args.resume_summary))

    metadata_done: set[str] = set()
    images_done: set[str] = set()
    if args.resume_log:
        metadata_done, images_done = parse_log_progress(Path(args.resume_log))

    url_keys = []
    conn = get_db_connection()
    try:
        url_keys = ordered_url_keys(conn)
    finally:
        conn.close()

    if skip_keys:
        url_keys = [k for k in url_keys if k not in skip_keys]

    if args.brands:
        wanted = {k.strip().lower() for k in args.brands.split(",") if k.strip()}
        url_keys = [k for k in url_keys if k in wanted]
        missing = wanted - set(url_keys)
        if missing:
            print(f"Warning: --brands not in ordered list: {sorted(missing)}")

    if args.only_metadata_done:
        if not args.resume_log:
            print("Error: --only-metadata-done requires --resume-log", file=sys.stderr)
            return 2
        url_keys = [k for k in url_keys if k in metadata_done and k not in images_done]

    totals = {
        "brands_total": len(url_keys),
        "brands_ok": 0,
        "brands_failed": 0,
        "inserted": 0,
        "updated": 0,
        "images_uploaded": 0,
        "images_skipped": 0,
        "images_failed": 0,
        "images_no_source": 0,
        "images_url_updated": 0,
    }
    brand_results: list[dict] = []
    failed_brands: list[dict] = []

    phases: list[str]
    if args.phase == "both":
        phases = ["metadata", "images"]
    elif args.phase == "pipeline":
        phases = ["pipeline"]
    else:
        phases = [args.phase]

    with open(log_path, "w", encoding="utf-8") as log_file:
        tee = Tee(sys.stdout, log_file)
        old_stdout = sys.stdout
        sys.stdout = tee
        try:
            print("=" * 60)
            print("FULL PTPRODUCTS SCRAPE (orchestrated)")
            print("=" * 60)
            print(f"Started: {started_at}")
            print(f"Log: {log_path}")
            print(f"Brands to process: {len(url_keys)}")
            print(f"Phase plan: {' -> '.join(phases)}")
            print(f"Workers: {args.workers}, delay: {args.delay}s")
            if args.phase == "pipeline":
                print(f"Image jobs (concurrent brands): {args.image_jobs}")
            if skip_keys:
                print(f"Resume summary: skipping {len(skip_keys)} fully completed brands")
            if metadata_done or images_done:
                print(
                    f"Resume log: metadata_done={len(metadata_done)}, "
                    f"images_done={len(images_done)}"
                )
            if args.skip_resumed_images:
                print("Skip resumed images: yes (separate catch-up pass)")
            print()

            conn = get_db_connection()
            session = setup_session(proxy=None)

            if args.phase == "pipeline":
                run_pipeline(
                    tee=tee,
                    conn=conn,
                    session=session,
                    url_keys=url_keys,
                    workers=args.workers,
                    dry_run=args.dry_run,
                    image_jobs=max(1, args.image_jobs),
                    metadata_done=metadata_done,
                    images_done=images_done,
                    skip_keys=skip_keys,
                    totals=totals,
                    brand_results=brand_results,
                    failed_brands=failed_brands,
                    skip_resumed_images=args.skip_resumed_images,
                )
            elif args.phase == "images" and args.image_jobs > 1:
                run_images_parallel(
                    tee=tee,
                    url_keys=url_keys,
                    workers=args.workers,
                    dry_run=args.dry_run,
                    image_jobs=max(1, args.image_jobs),
                    images_done=images_done,
                    totals=totals,
                    brand_results=brand_results,
                    failed_brands=failed_brands,
                )
            else:
                for phase_idx, phase in enumerate(phases, start=1):
                    print("\n" + "#" * 60)
                    print(f"PHASE {phase_idx}/{len(phases)}: {phase.upper()}")
                    print("#" * 60)

                    for i, url_key in enumerate(url_keys, start=1):
                        brand_info = get_brand_by_url_key(conn, url_key)
                        if not brand_info:
                            msg = f"url_key not found: {url_key}"
                            if phase_idx == 1:
                                print(f"\n[{i}/{len(url_keys)}] SKIP — {msg}")
                                failed_brands.append({"url_key": url_key, "error": msg})
                                totals["brands_failed"] += 1
                                brand_results.append(
                                    {"url_key": url_key, "status": "missing", "error": msg}
                                )
                            continue

                        print(
                            f"\n[{i}/{len(url_keys)}] Brand: {brand_info['name']} ({url_key}) "
                            f"[phase={phase}]"
                        )

                        status, stats = run_brand(
                            tee=tee,
                            conn=conn,
                            session=session,
                            brand_info=brand_info,
                            phase=phase,
                            workers=args.workers,
                            dry_run=args.dry_run,
                        )

                        if status == "failed":
                            totals["brands_failed"] += 1
                            failed_brands.append(
                                {
                                    "url_key": url_key,
                                    "name": brand_info["name"],
                                    "phase": phase,
                                    "error": stats.get("error", "unknown"),
                                }
                            )
                            brand_results.append(
                                {
                                    "url_key": url_key,
                                    "name": brand_info["name"],
                                    "phase": phase,
                                    "status": "failed",
                                    "error": stats.get("error", "unknown"),
                                }
                            )
                            try:
                                if conn.closed:
                                    conn = get_db_connection()
                                else:
                                    conn.rollback()
                            except Exception:
                                conn = get_db_connection()
                            time.sleep(5)
                            continue

                        if phase_idx == len(phases):
                            totals["brands_ok"] += 1
                        for k in (
                            "inserted",
                            "updated",
                            "images_uploaded",
                            "images_skipped",
                            "images_failed",
                            "images_no_source",
                            "images_url_updated",
                        ):
                            totals[k] += stats.get(k, 0)
                        brand_results.append(
                            {
                                "url_key": url_key,
                                "name": brand_info["name"],
                                "phase": phase,
                                "status": "ok",
                                **stats,
                            }
                        )

            conn.close()
        finally:
            sys.stdout = old_stdout

    elapsed_s = time.time() - t0
    summary = {
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(elapsed_s, 1),
        "elapsed_human": f"{int(elapsed_s // 3600)}h {int((elapsed_s % 3600) // 60)}m {int(elapsed_s % 60)}s",
        "log_path": str(log_path),
        "phase": args.phase,
        "workers": args.workers,
        "image_jobs": args.image_jobs if args.phase == "pipeline" else None,
        "delay": args.delay,
        "resume_log": args.resume_log,
        "resume_summary": args.resume_summary,
        "totals": totals,
        "failed_brands": failed_brands,
        "brands": brand_results,
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("FULL SCRAPE FINISHED")
    print(json.dumps(totals, indent=2))
    print(f"Summary: {summary_path}")
    print("=" * 60)
    return 0 if totals["brands_failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
