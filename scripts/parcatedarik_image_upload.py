"""
Download ParcaTedarik product images and upload to Supabase Storage.

Bucket/path convention (aligned with part-images usage elsewhere):
  {SUPABASE_PART_IMAGES_BUCKET or part-images}/ptproducts/{brand_url_key}/{product_id}.{ext}
"""

from __future__ import annotations

import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    requests = None  # type: ignore

try:
    from dotenv import dotenv_values
except ImportError:
    dotenv_values = None  # type: ignore

PARCATEDARIK_ORIGIN = "https://parcatedarik.com"
DEFAULT_BUCKET = "part-images"
STORAGE_PREFIX = "ptproducts"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}


class ImageUploadStats:
    def __init__(self):
        self.uploaded = 0
        self.skipped = 0
        self.failed = 0
        self.no_source = 0
        self._lock = threading.Lock()

    def inc(self, field: str, n: int = 1) -> None:
        with self._lock:
            setattr(self, field, getattr(self, field) + n)


def get_project_dir() -> Path:
    return Path(__file__).parent.parent


def load_env_values() -> dict:
    project_dir = get_project_dir()
    env_file = project_dir / ".env.local"
    if not env_file.exists():
        env_file = project_dir / ".env"
    if not env_file.exists() or dotenv_values is None:
        return {}
    return dict(dotenv_values(env_file))


def get_supabase_config() -> tuple[str, str, str]:
    env = load_env_values()
    supabase_url = (
        env.get("NEXT_PUBLIC_SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).rstrip("/")
    service_key = (
        env.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    bucket = (
        env.get("SUPABASE_PART_IMAGES_BUCKET")
        or os.environ.get("SUPABASE_PART_IMAGES_BUCKET")
        or DEFAULT_BUCKET
    )
    if not supabase_url or not service_key:
        raise RuntimeError(
            "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for image upload"
        )
    return supabase_url, service_key, bucket


def sanitize_storage_segment(value: str) -> str:
    cleaned = value.strip().lower()
    cleaned = re.sub(r"[^a-z0-9-_]+", "-", cleaned)
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "unknown"


def extension_from_url(url: str) -> str:
    try:
        path = urlparse(url).path
        segment = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if segment in {"jpg", "jpeg", "png", "webp", "gif"}:
            return "jpg" if segment == "jpeg" else segment
    except Exception:
        pass
    return "jpg"


def extension_from_content_type(content_type: str | None) -> str:
    if not content_type:
        return "jpg"
    base = content_type.split(";", 1)[0].strip().lower()
    mapping = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    return mapping.get(base, "jpg")


def storage_path_for(brand_url_key: str, product_id: str, ext: str) -> str:
    brand = sanitize_storage_segment(brand_url_key)
    product = sanitize_storage_segment(product_id)
    safe_ext = ext if ext in {"jpg", "png", "webp", "gif"} else "jpg"
    return f"{STORAGE_PREFIX}/{brand}/{product}.{safe_ext}"


def get_public_url(storage_path: str, supabase_url: str, bucket: str) -> str:
    return f"{supabase_url}/storage/v1/object/public/{bucket}/{storage_path}"


def is_supabase_ptproduct_image_url(
    image_url: str | None, supabase_url: str, bucket: str
) -> bool:
    if not image_url:
        return False
    try:
        parsed = urlparse(image_url)
        if "supabase.co" not in parsed.netloc:
            return False
        marker = f"/object/public/{bucket}/{STORAGE_PREFIX}/"
        return marker in parsed.path
    except Exception:
        return False


def is_parcatedarik_image_url(image_url: str | None) -> bool:
    if not image_url:
        return False
    try:
        return "parcatedarik.com" in urlparse(image_url).netloc
    except Exception:
        return False


def download_image(source_url: str, session=None) -> tuple[bytes | None, str | None, str | None]:
    if requests is None:
        return None, None, "requests not installed"

    http = session or requests
    try:
        response = http.get(
            source_url,
            timeout=20,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": PARCATEDARIK_ORIGIN,
                "Origin": PARCATEDARIK_ORIGIN,
            },
        )
        if not response.ok:
            return None, None, f"HTTP {response.status_code}"

        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type and content_type not in ALLOWED_CONTENT_TYPES:
            return None, None, f"unsupported content-type: {content_type}"

        data = response.content
        if not data:
            return None, None, "empty response"
        if len(data) > MAX_IMAGE_BYTES:
            return None, None, f"file too large ({len(data)} bytes)"

        return data, content_type or "image/jpeg", None
    except Exception as exc:
        return None, None, str(exc)


def object_exists_in_supabase(
    storage_path: str,
    *,
    supabase_url: str,
    service_key: str,
    bucket: str,
    session=None,
) -> bool:
    if requests is None:
        return False

    http = session or requests
    check_url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
    try:
        response = http.head(
            check_url,
            headers={"Authorization": f"Bearer {service_key}"},
            timeout=10,
        )
        return response.status_code == 200
    except Exception:
        return False


def upload_bytes_to_supabase(
    storage_path: str,
    data: bytes,
    content_type: str,
    *,
    supabase_url: str,
    service_key: str,
    bucket: str,
    session=None,
) -> tuple[str | None, str | None]:
    if requests is None:
        return None, "requests not installed"

    http = session or requests
    upload_url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
    try:
        response = http.post(
            upload_url,
            data=data,
            headers={
                "Authorization": f"Bearer {service_key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            timeout=60,
        )
        if response.status_code not in (200, 201):
            detail = response.text[:200] if response.text else f"HTTP {response.status_code}"
            return None, detail
        return get_public_url(storage_path, supabase_url, bucket), None
    except Exception as exc:
        return None, str(exc)


class PtProductImageUploader:
    """Upload ParcaTedarik product images to Supabase Storage."""

    def __init__(self, session=None):
        self.session = session
        self.supabase_url, self.service_key, self.bucket = get_supabase_config()
        self.stats = ImageUploadStats()
        self._thread_local = threading.local()

    def _http_session(self):
        if self.session is not None:
            return self.session
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = requests.Session()
            self._thread_local.session = session
        return session

    def expected_public_url(self, brand_url_key: str, product_id: str, source_url: str) -> str:
        ext = extension_from_url(source_url)
        path = storage_path_for(brand_url_key, product_id, ext)
        return get_public_url(path, self.supabase_url, self.bucket)

    def resolve_image_url(
        self,
        *,
        source_url: str | None,
        brand_url_key: str,
        product_id: str,
        existing_image_url: str | None = None,
    ) -> str | None:
        return self._resolve_image_url_impl(
            source_url=source_url,
            brand_url_key=brand_url_key,
            product_id=product_id,
            existing_image_url=existing_image_url,
            http=self._http_session(),
        )

    def resolve_batch(
        self,
        items: list[dict],
        *,
        max_workers: int = 6,
    ) -> dict[str, str | None]:
        """Parallel download+upload. DB writes remain sequential in the scraper."""
        if not items:
            return {}

        workers = max(1, min(max_workers, len(items)))
        if workers == 1:
            return {
                item["key"]: self.resolve_image_url(
                    source_url=item.get("source_url"),
                    brand_url_key=item.get("brand_url_key") or "",
                    product_id=item.get("product_id") or "",
                    existing_image_url=item.get("existing_image_url"),
                )
                for item in items
            }

        results: dict[str, str | None] = {}
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(
                    self._resolve_image_url_impl,
                    source_url=item.get("source_url"),
                    brand_url_key=item.get("brand_url_key") or "",
                    product_id=item.get("product_id") or "",
                    existing_image_url=item.get("existing_image_url"),
                    http=None,
                ): item["key"]
                for item in items
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    results[key] = future.result()
                except Exception:
                    item = next(i for i in items if i["key"] == key)
                    results[key] = item.get("existing_image_url")
                    self.stats.inc("failed")
        return results

    def _resolve_image_url_impl(
        self,
        *,
        source_url: str | None,
        brand_url_key: str,
        product_id: str,
        existing_image_url: str | None = None,
        http=None,
    ) -> str | None:
        if not source_url or not source_url.strip():
            self.stats.inc("no_source")
            return existing_image_url

        http = http or self._http_session()
        source_url = source_url.strip()
        expected = self.expected_public_url(brand_url_key, product_id, source_url)
        storage_path = storage_path_for(
            brand_url_key, product_id, extension_from_url(source_url)
        )

        if existing_image_url == expected:
            self.stats.inc("skipped")
            return existing_image_url

        if is_supabase_ptproduct_image_url(
            existing_image_url, self.supabase_url, self.bucket
        ):
            if existing_image_url and not is_parcatedarik_image_url(existing_image_url):
                self.stats.inc("skipped")
                return existing_image_url

        if object_exists_in_supabase(
            storage_path,
            supabase_url=self.supabase_url,
            service_key=self.service_key,
            bucket=self.bucket,
            session=http,
        ):
            self.stats.inc("skipped")
            return expected

        data, content_type, err = download_image(source_url, session=http)
        if not data:
            self.stats.inc("failed")
            return existing_image_url

        ext = extension_from_content_type(content_type)
        storage_path = storage_path_for(brand_url_key, product_id, ext)
        public_url, upload_err = upload_bytes_to_supabase(
            storage_path,
            data,
            content_type or "image/jpeg",
            supabase_url=self.supabase_url,
            service_key=self.service_key,
            bucket=self.bucket,
            session=http,
        )
        if not public_url:
            self.stats.inc("failed")
            return existing_image_url

        self.stats.inc("uploaded")
        return public_url
