"""
OEM RPA orkestratoru.

Akis (onay kuyrugu tasarimi):

  python -m src.main --collect
    catalog.products'tan (product_id, brand, part_no) okur
    -> Google AI Modu'na sorar (metin + kaynak URL'ler)
    -> parser + eleme -> ingest JSON sekli
    -> suggestions.json (ve gozat icin review.csv) yazar.
    Panele/DB'ye DOGRUDAN YAZMAZ.

  Sonra: kendi ingest scriptinle (ingest-gemini-oems.ts kopyasi,
  SOURCE_SITE='rpa-claude') suggestions.json'i
  catalog.product_ref_suggestions'a (status=PENDING) yazarsin.
  Onay/ret Admin > Eslestirme > Zenginlestirme ekraninda yapilir;
  onaylananlar product_oems (source='WEB') + product_overrides.name_override'a gider.
"""

import argparse
import csv
import json
import os
import shlex
import subprocess
import sys

import yaml

from .parser import parse
from .suggestions import build_suggestion, is_emittable

REVIEW_FIELDS = ["product_id", "sku", "brand", "name", "oems",
                 "grounded", "sources", "note"]


def load_config(path: str) -> dict:
    if not os.path.exists(path):
        sys.exit(f"[HATA] {path} yok. config.example.yaml'i kopyalayip doldur.")
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def collect(cfg: dict):
    from . import db                        # lazy: psycopg2
    from .google_lookup import GoogleAIMode, CaptchaBlocked   # lazy: playwright

    products = db.fetch_products(cfg["database"])
    print(f"[i] {len(products)} parca cekildi.")

    out_cfg = cfg.get("output", {})
    json_path = out_cfg.get("json_file", "suggestions.json")
    review_path = out_cfg.get("review_file", "review.csv")
    suggestions, review_rows = [], []

    # Otomatik DB yazma ayarlari
    auto_ingest = out_cfg.get("auto_ingest", False)
    ingest_every = int(out_cfg.get("ingest_every", 25) or 0)
    # Batch: tek sorguda kac parca (1 = klasik, tek tek). >1 -> cok az istek/CAPTCHA.
    batch_size = int(cfg.get("google", {}).get("batch_size", 1) or 1)

    attempt_marks = []   # [(product_id, status, oem_count)] -> rpa_lookup_log

    def _flush():
        # Her urunden sonra diske yaz. Atomik (once .tmp sonra replace) ki
        # ortada Ctrl+C olsa bile dosya bozulmaz ve o ana kadarki her sey durur.
        tmp = json_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(suggestions, f, ensure_ascii=False, indent=2)
        os.replace(tmp, json_path)
        _write_review(review_path, review_rows)

    def _flush_marks():
        # Sorgulanan urunleri DB'ye isaretle (bos dahil) -> tekrar sorulmaz.
        if not attempt_marks:
            return
        try:
            db.mark_attempts(cfg["database"], attempt_marks)
        except Exception as e:
            print("    [!] deneme kaydi yazilamadi:", e)
        else:
            attempt_marks.clear()

    def _ingest_to_db(tag=""):
        # collect'in kendisi DB'ye YAZMAZ; otoriter yazma mantigi (normalizeOem,
        # code_norm, marka cozumleme, override upsert) bun/TS scriptinde. Onu
        # subprocess ile cagiririz. ON CONFLICT sayesinde tekrar cagirmak guvenli.
        if not auto_ingest:
            return
        cmd = out_cfg.get(
            "ingest_cmd",
            f"bun scripts/ingest-rpa-oems.ts --file=oem_rpa/{json_path}",
        )
        cwd = out_cfg.get("ingest_cwd", "..")
        print(f"  [auto-ingest{tag}] DB'ye yaziliyor: {cmd}")
        try:
            res = subprocess.run(
                shlex.split(cmd), cwd=cwd, capture_output=True,
                text=True, timeout=600,
            )
            for line in (res.stdout or "").strip().splitlines()[-5:]:
                print("    " + line)
            if res.returncode != 0:
                print("    [!] ingest hatasi:", (res.stderr or "")[-400:])
        except Exception as e:
            print("    [!] ingest calistirilamadi:", e)

    def _run_batch_loop(g):
        from .parser import parse_batch
        from .google_lookup import CaptchaBlocked as _CB
        total = len(products)
        since = 0
        for ci in range(0, total, batch_size):
            chunk = products[ci:ci + batch_size]
            labels = ", ".join(f"{p.get('brand','')} {p['part_no']}" for p in chunk)
            print(f"[{ci + 1}-{ci + len(chunk)}/{total}] batch({len(chunk)}): {labels[:120]}")
            try:
                raw, sources = g.ask_batch(
                    [(p.get("brand", ""), p["part_no"]) for p in chunk])
            except _CB as e:
                print(f"    [!] CAPTCHA asilamadi, durduruluyor: {e}")
                return
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"    [!] batch hata: {e}")
                for p in chunk:
                    review_rows.append(_review_row(p, None, [], note=f"batch hata: {e}"))
                _flush()
                continue

            # Cevapta hic etiket yoksa CIKARIM basarisiz (CSS/shell/render yok).
            # Bu durumda urunleri EMPTY isaretleme -> tekrar denensin.
            low = (raw or "").lower()
            has_labels = ("oem no" in low or "oem numar" in low
                          or "parça ad" in low or "parca ad" in low)

            parsed = parse_batch(raw, chunk)
            hit = 0
            for p, r in zip(chunk, parsed):
                sug = build_suggestion(p, r, sources)
                if is_emittable(sug):
                    hit += 1
                    suggestions.append(sug)
                    review_rows.append(_review_row(p, r, sources))
                    attempt_marks.append(
                        (p["product_id"], "FOUND", len(sug["oem_references"])))
                elif has_labels:
                    # Cevap geldi ama gercek veri yok (ABA ic kodu gibi) -> EMPTY.
                    review_rows.append(_review_row(
                        p, r, sources, note="batch: veri yok"))
                    attempt_marks.append((p["product_id"], "EMPTY", 0))
                # has_labels False ise: isaretleme yok -> sonraki calismada tekrar
            print(f"    -> {hit}/{len(chunk)} eslesti, {len(chunk) - hit} atlandi"
                  + ("" if has_labels else "  [!] cikarim basarisiz (etiket yok)"))
            if not has_labels:
                try:
                    with open("last_batch_raw.txt", "w", encoding="utf-8") as _f:
                        _f.write(raw or "")
                    print("    [!] ham cevap 'last_batch_raw.txt'e yazildi (cikarim/render)")
                except Exception:
                    pass
            _flush()
            _flush_marks()   # sorgulanan urunleri (bos dahil) isaretle
            since += len(chunk)
            if auto_ingest and ingest_every > 0 and since >= ingest_every:
                _ingest_to_db(f" {ci + len(chunk)}/{total}")
                since = 0

    interrupted = False
    empty_streak = 0
    try:
        with GoogleAIMode(cfg["google"]) as g:
            _single = [] if batch_size > 1 else list(enumerate(products, 1))
            if batch_size > 1:
                _run_batch_loop(g)
            for i, p in _single:
                brand, part = p.get("brand", ""), p["part_no"]
                print(f"[{i}/{len(products)}] pid={p['product_id']} {brand} {part} ...")
                try:
                    raw, sources = g.ask(brand, part)
                    r = parse(raw)
                except CaptchaBlocked as e:
                    print(f"    [!] CAPTCHA asilamadi, calisma temiz sekilde durduruluyor: {e}")
                    print("    (o ana kadarki her sey DB'ye yazildi; atlanan urunler "
                          "sonraki calismada tekrar denenir)")
                    break
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    print(f"    [!] hata: {e}")
                    review_rows.append(_review_row(p, None, [], note=f"hata: {e}"))
                    _flush()
                    continue

                sug = build_suggestion(p, r, sources)

                if is_emittable(sug):
                    empty_streak = 0
                    suggestions.append(sug)
                    review_rows.append(_review_row(p, r, sources))
                    attempt_marks.append(
                        (p["product_id"], "FOUND", len(sug["oem_references"])))
                    print(f"    -> {r.name or '(ad yok)'} | "
                          f"{len(sug['oem_references'])} OEM | "
                          f"grounded={sug['grounded']}")
                else:
                    empty_streak += 1
                    review_rows.append(_review_row(
                        p, r, sources, note="bos cevap (Google OEM/ad vermedi)"))
                    attempt_marks.append((p["product_id"], "EMPTY", 0))
                    print("    [!] gonderilebilir icerik yok (product_id/OEM/ad bos)")
                    if empty_streak in (10, 25, 50):
                        print(f"    [!!] ust uste {empty_streak} bos cevap — tarayiciyi "
                              "kontrol et (oturum/CAPTCHA) ya da conversation_mode'u "
                              "kapat.")
                _flush()   # kesinti olsa da o ana kadarki her sey suggestions.json'da

                # Her ingest_every urunde bir DB'ye yaz ("bulundukca")
                if auto_ingest and ingest_every > 0 and i % ingest_every == 0:
                    _ingest_to_db(f" {i}/{len(products)}")
                    _flush_marks()
    except KeyboardInterrupt:
        # Ctrl+C: traceback dokme. Toplananlari yazip duzgunce cikariz.
        interrupted = True
        print("\n[i] Ctrl+C — temiz duruluyor, o ana kadarki oneriler yaziliyor...")

    _flush()
    _flush_marks()          # kalan deneme kayitlari
    _ingest_to_db(" son")   # kalan urunler de DB'ye
    if interrupted:
        print(f"[OK] yarida kesildi: {len(suggestions)} oneri kaydedildi -> {json_path}")
        print("     (islenmeyen urunler sonraki calismada kaldigi yerden denenir)")
    print(f"\n[OK] {len(suggestions)} oneri -> {json_path}")
    print(f"[OK] gozat: {review_path}")
    if not auto_ingest:
        print("\nSonraki adim (getirbakim kokunden):")
        print(f"  bun scripts/ingest-rpa-oems.ts --file=oem_rpa/{json_path}")
        print("  -> product_ref_suggestions (OEM) + product_overrides (ad)")


def _review_row(p, r, sources, note=""):
    return {
        "product_id": p.get("product_id", ""),
        "sku": p.get("part_no", ""),
        "brand": p.get("brand", ""),
        "name": r.name if r else "",
        "oems": ", ".join(r.oem_strings) if r else "",
        "grounded": bool(sources),
        "sources": " | ".join(sources or []),
        "note": note,
    }


def _write_review(path: str, rows: list):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=REVIEW_FIELDS)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description="OEM RPA (oneri kuyrugu uretici)")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--collect", action="store_true",
                    help="Topla ve suggestions.json + review.csv yaz")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.collect:
        try:
            collect(cfg)
        except KeyboardInterrupt:
            # Emniyet kemeri: kapanis/ingest sirasindaki ikinci Ctrl+C de
            # traceback yerine tek satirla cikisa donsun.
            print("\n[i] durduruldu.")
            sys.exit(130)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
