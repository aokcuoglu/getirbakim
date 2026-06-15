#!/usr/bin/env python3
"""
ParcaTedarik.com Üretici Ürün Verisi Çekme Scripti
===================================================
Kullanım:
    python parcatedarik_scraper.py

Özellikler:
- Tüm üreticilerin ürünlerini çeker
- 120 ürün/sayfa olarak sayfalar
- Kesinti sonrası devam edebilir
- PostgreSQL v0 şemasına yazar
- Rate limiting ile sunucu yükünü azaltır

Gerekli kütüphaneler:
    pip install requests psycopg2-binary python-dotenv
"""

import os
import re
import time
import json
import argparse
import html
from decimal import Decimal, InvalidOperation
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("Gerekli kütüphane bulunamadı.")
    print("Kurulum için: pip install requests")
    exit(1)

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Gerekli kütüphane bulunamadı.")
    print("Kurulum için: pip install psycopg2-binary")
    exit(1)

try:
    from dotenv import dotenv_values
except ImportError:
    print("Gerekli kütüphane bulunamadı.")
    print("Kurulum için: pip install python-dotenv")
    exit(1)

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from parcatedarik_image_upload import PtProductImageUploader
except ImportError:
    from scripts.parcatedarik_image_upload import PtProductImageUploader


BASE_URL = "https://parcatedarik.com"
PAGE_SIZE = 120
REQUEST_DELAY = 1.0
MAX_RETRIES = 3
# Report-only threshold for long ref_no samples. ref_no must NEVER be truncated on
# scrape or upsert — store the full site value exactly (ptprd.ref_no is text).
REF_NO_WARN_LENGTH = 80


class ProxyRotator:
    """Proxy havuzunu yöneten ve hata durumunda otomatik rotate eden sınıf."""

    def __init__(self, proxies=None):
        self.proxies = proxies or []
        self.current_index = 0
        self.fail_counts = {}  # proxy -> ardışık hata sayısı
        self.max_fails = 3  # Bu kadar ardışık hatadan sonra rotate et

    @classmethod
    def from_file(cls, filepath):
        """Proxy listesini dosyadan yükle (satır başına bir proxy)."""
        proxies = []
        path = Path(filepath)
        if not path.exists():
            print(f"Hata: Proxy dosyası bulunamadı: {filepath}")
            return cls([])

        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    proxies.append(line)

        print(f"✓ {len(proxies)} proxy yüklendi: {filepath}")
        return cls(proxies)

    @property
    def current(self):
        """Aktif proxy'yi döndür. Proxy yoksa None."""
        if not self.proxies:
            return None
        return self.proxies[self.current_index % len(self.proxies)]

    def rotate(self):
        """Bir sonraki proxy'ye geç."""
        if not self.proxies:
            return None
        old = self.current
        self.current_index = (self.current_index + 1) % len(self.proxies)
        new = self.current
        if old != new:
            print(f"  🔄 Proxy değiştiriliyor: {_mask_proxy(new)}")
        return new

    def report_success(self):
        """Başarılı istek sonrası hata sayacını sıfırla."""
        if self.current:
            self.fail_counts[self.current] = 0

    def report_failure(self):
        """Başarısız istek sonrası hata sayacını artır, gerekirse rotate et. Rotate olduysa True döner."""
        if not self.proxies:
            return False
        proxy = self.current
        self.fail_counts[proxy] = self.fail_counts.get(proxy, 0) + 1
        if self.fail_counts[proxy] >= self.max_fails:
            self.fail_counts[proxy] = 0
            self.rotate()
            return True
        return False


def _mask_proxy(proxy):
    """Proxy URL'sindeki şifreyi gizle."""
    if not proxy:
        return "None"
    if "@" in proxy:
        scheme_end = proxy.find("://") + 3
        at_pos = proxy.index("@")
        return proxy[:scheme_end] + "***@" + proxy[at_pos + 1:]
    return proxy


def get_project_dir():
    """Proje kök dizinini döndür."""
    return Path(__file__).parent.parent


def get_db_url():
    """DATABASE_URL'yi .env.local dosyasından oku."""
    project_dir = get_project_dir()
    env_file = project_dir / ".env.local"
    if not env_file.exists():
        env_file = project_dir / ".env"

    if not env_file.exists():
        print(f"Hata: .env.local veya .env bulunamadı!")
        exit(1)

    env_values = dotenv_values(env_file)
    db_url = env_values.get("DATABASE_URL")

    if not db_url:
        print("Hata: DATABASE_URL .env.local dosyasında bulunamadı!")
        exit(1)

    # Veritabanı bağlantı URL'sinden pgbouncer parametresini çıkar
    # ve doğrudan bağlantı portu kullan
    return db_url.replace("?pgbouncer=true", "")


def get_db_connection():
    """PostgreSQL bağlantısı oluştur."""
    db_url = get_db_url()
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '120s'")
        conn.commit()
        return conn
    except psycopg2.Error as e:
        print(f"Veritabanı bağlantı hatası: {e}")
        exit(1)


def setup_session(proxy=None):
    """Session oluştur ve retry strategy ekle."""
    session = requests.Session()

    retry_strategy = Retry(
        total=MAX_RETRIES,
        backoff_factor=1,
        status_forcelist=[429, 502, 503, 504],
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        }
    )

    if proxy:
        session.proxies = {
            "http": proxy,
            "https": proxy,
        }

    return session


def apply_proxy_to_session(session, proxy):
    """Session'a proxy uygula."""
    if proxy:
        session.proxies = {"http": proxy, "https": proxy}
    else:
        session.proxies = {}


def make_manufacturer_url(name):
    """Üretici isminden parcatedarik.com URL'si oluştur."""
    # "BOSCH" -> "bosch", "MANN FILTER" -> "mann-filter"
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return f"{BASE_URL}/{slug}"


def load_manufacturers_from_csv(project_dir):
    """Üreticileri CSV'den yükle (varsa)."""
    import csv

    manufacturers = []
    manufacturers_csv = project_dir / "data" / "parcatedarik_ureticiler.csv"

    if not manufacturers_csv.exists():
        return None  # CSV yok, None döndür

    with open(manufacturers_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            manufacturers.append(
                {"name": row["manufacturer_name"], "url": row["manufacturer_url"]}
            )

    return manufacturers


def fetch_manufacturers_from_site(session, project_dir=None, proxy_rotator=None):
    """Üretici listesini parcatedarik.com/manufacturer/all'dan çek ve CSV'ye kaydet."""
    print("\nÜretici listesi siteden çekiliyor...")
    manufacturers = []
    max_attempts = max(len(proxy_rotator.proxies), 1) * 2 if proxy_rotator and proxy_rotator.proxies else 1
    attempt = 0

    while attempt < max_attempts:
        attempt += 1
        try:
            response = session.get(f"{BASE_URL}/manufacturer/all", timeout=60)
            response.raise_for_status()
            html_content = response.text

            if "internal error occurred" in html_content.lower() or "dahili bir teknik hata" in html_content.lower():
                print("  Sunucu hata sayfası döndürdü!")
                if proxy_rotator and proxy_rotator.proxies:
                    proxy_rotator.rotate()
                    apply_proxy_to_session(session, proxy_rotator.current)
                    print(f"  Proxy değiştirildi, tekrar deneniyor... (deneme {attempt}/{max_attempts})")
                    time.sleep(REQUEST_DELAY)
                    continue
                return manufacturers
            break
        except requests.exceptions.RequestException as e:
            print(f"  Site çekilirken hata: {e}")
            if proxy_rotator and proxy_rotator.proxies and attempt < max_attempts:
                proxy_rotator.rotate()
                apply_proxy_to_session(session, proxy_rotator.current)
                print(f"  Proxy değiştirildi, tekrar deneniyor... (deneme {attempt}/{max_attempts})")
                time.sleep(REQUEST_DELAY)
                continue
            return manufacturers

    # Örnek HTML: <div class=manufacturer-item><h2 class=title><a href=/bosch title=BOSCH> BOSCH </a></h2>
    mfr_pattern = re.compile(
        r'class=manufacturer-item.*?<h2\s+class=title><a\s+href=(?:"|/)([^"\s>]+)[^>]*>(.*?)</a></h2>',
        re.IGNORECASE | re.DOTALL,
    )

    seen = set()
    for match in mfr_pattern.finditer(html_content):
        href = match.group(1).strip()
        if not href.startswith('/'):
            href = '/' + href

        name = match.group(2).strip()
        name = html.unescape(name)

        if not name or href in seen:
            continue

        seen.add(href)
        manufacturers.append({
            "name": name,
            "url": f"{BASE_URL}{href}",
        })

    print(f"  Siteden {len(manufacturers)} üretici bulundu")

    # CSV'ye kaydet — bir sonraki çalıştırmada siteye gerek kalmaz
    if manufacturers and project_dir:
        save_manufacturers_to_csv(manufacturers, project_dir)

    return manufacturers


def save_manufacturers_to_csv(manufacturers, project_dir):
    """Üretici listesini CSV dosyasına kaydet."""
    import csv

    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    csv_path = data_dir / "parcatedarik_ureticiler.csv"

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["manufacturer_name", "manufacturer_url"])
        writer.writeheader()
        for m in manufacturers:
            writer.writerow({
                "manufacturer_name": m["name"],
                "manufacturer_url": m["url"],
            })

    print(f"  ✓ {len(manufacturers)} üretici CSV'ye kaydedildi: {csv_path}")


def load_manufacturers_from_db(conn):
    """DB'den mevcut üreticileri yükle."""
    manufacturers = []
    with conn.cursor() as cur:
        cur.execute(
            'SELECT name, url_key FROM "v0"."ptbrd" ORDER BY name'
        )
        for row in cur.fetchall():
            name, url_key = row
            url = f"{BASE_URL}/{url_key}" if url_key else make_manufacturer_url(name)
            manufacturers.append({"name": name, "url": url})
    return manufacturers


def ensure_manufacturer_in_db(conn, name, url):
    """Üreticiyi DB'ye ekle veya mevcut ID'yi döndür."""
    # url'den url_key oluştur
    url_key = url.replace(BASE_URL, "").strip("/").lower() if url else None

    with conn.cursor() as cur:
        # Önce url_key üzerinden mevcut mu kontrol et
        cur.execute(
            'SELECT id FROM "v0"."ptbrd" WHERE url_key = %s',
            (url_key,),
        )
        row = cur.fetchone()
        if row:
            return row[0]

        # Yoksa ekle
        cur.execute(
            """
            INSERT INTO "v0"."ptbrd" (name, url_key, created_at, updated_at)
            VALUES (%s, %s, NOW(), NOW())
            ON CONFLICT (url_key) DO UPDATE SET 
                name = EXCLUDED.name,
                updated_at = NOW()
            RETURNING id
            """,
            (name, url_key),
        )
        conn.commit()
        return cur.fetchone()[0]


def fetch_existing_image_urls_by_urls(conn, urls):
    """Batch-fetch existing image_url values for product URLs."""
    if not urls:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            'SELECT url, image_url FROM "v0"."ptprd" WHERE url = ANY(%s)',
            (urls,),
        )
        return {row[0]: row[1] for row in cur.fetchall()}


def upsert_product(
    conn,
    manufacturer_id,
    product_data,
    dry_run=False,
    upload_images=False,
    image_uploader=None,
    brand_url_key=None,
    pre_resolved_image_url=None,
):
    """Ürünü DB'ye ekle veya güncelle."""
    product_id = product_data.get("product_id", "")
    if not product_id:
        return None

    title = product_data.get("product_title") or product_data.get("title", "")
    url = product_data.get("product_url") or product_data.get("url", "")
    source_image_url = product_data.get("image_url", "") or None
    # Full ref_no as scraped — no length cap (legacy rows may be 80-char truncated).
    ref_no = product_data.get("ref_no", "") or None
    model = product_data.get("model") or None
    sku = product_data.get("sku") or None

    price_raw = product_data.get("price_list")
    if price_raw is None:
        price_raw = product_data.get("price", "")
    price = parse_price(price_raw)
    price_actual = parse_price(product_data.get("price_actual"))

    if dry_run:
        return ("dry_run", None)

    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, price, image_url, ref_no, title, model, sku, price_actual FROM "v0"."ptprd" WHERE url = %s',
            (url,),
        )
        existing = cur.fetchone()

        existing_image_url = existing[2] if existing else None
        image_url = source_image_url
        if pre_resolved_image_url is not None:
            image_url = pre_resolved_image_url
        elif upload_images and image_uploader and source_image_url:
            image_url = image_uploader.resolve_image_url(
                source_url=source_image_url,
                brand_url_key=brand_url_key or "",
                product_id=product_id,
                existing_image_url=existing_image_url,
            )
        elif existing_image_url:
            image_url = existing_image_url

        if existing:
            (
                existing_id,
                existing_price,
                _existing_image_url,
                existing_ref_no,
                existing_title,
                existing_model,
                existing_sku,
                existing_price_actual,
            ) = existing

            needs_update = False
            updates = []

            if image_url and image_url != existing_image_url:
                updates.append(("image_url = %s", image_url))
                needs_update = True

            if ref_no is not None and existing_ref_no != ref_no:
                updates.append(("ref_no = %s", ref_no))
                needs_update = True

            if title and existing_title != title:
                updates.append(("title = %s", title))
                needs_update = True

            if model is not None and existing_model != model:
                updates.append(("model = %s", model))
                needs_update = True

            if sku is not None and existing_sku != sku:
                updates.append(("sku = %s", sku))
                needs_update = True

            if not decimal_equal(price, existing_price):
                updates.append(("price = %s", price))
                needs_update = True

            if not decimal_equal(price_actual, existing_price_actual):
                updates.append(("price_actual = %s", price_actual))
                needs_update = True

            if not needs_update:
                return ("skipped", existing_id)

            set_clause = ", ".join([u[0] for u in updates] + ["updated_at = NOW()"])
            values = [u[1] for u in updates] + [existing_id]
            cur.execute(
                f'UPDATE "v0"."ptprd" SET {set_clause} WHERE id = %s',
                values,
            )
            return ("updated", existing_id)

        cur.execute(
            """
            INSERT INTO "v0"."ptprd"
                (ptbrands_id, product_id, title, url, image_url, ref_no, model, sku, price, price_actual, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (url) DO UPDATE
                SET title = EXCLUDED.title,
                    product_id = EXCLUDED.product_id,
                    image_url = EXCLUDED.image_url,
                    ref_no = EXCLUDED.ref_no,
                    model = EXCLUDED.model,
                    sku = EXCLUDED.sku,
                    price = EXCLUDED.price,
                    price_actual = EXCLUDED.price_actual,
                    updated_at = NOW()
            RETURNING id, (xmax = 0) AS inserted
            """,
            (manufacturer_id, product_id, title, url, image_url, ref_no, model, sku, price, price_actual),
        )
        row = cur.fetchone()
        new_id = row[0]
        action = "inserted" if row[1] else "updated"
        return (action, new_id)


def parse_price(price_str):
    """Fiyat string'ini Decimal'e çevir (HTML entity ve TL/₺ destekli)."""
    if price_str is None or price_str == "":
        return None

    if isinstance(price_str, Decimal):
        return price_str

    cleaned = html.unescape(str(price_str))
    cleaned = cleaned.replace("\u20ba", "").replace("₺", "").replace("TL", "")
    cleaned = cleaned.strip().replace(" ", "")

    if not cleaned:
        return None

    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(".") == 1 and len(cleaned.split(".")[-1]) != 2:
        cleaned = cleaned.replace(".", "")

    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def derive_model_from_sku(sku, url_key=None):
    """SKU suffix'inden model çıkar (örn. 3rg-10109 -> 10109)."""
    if not sku:
        return None

    sku_norm = sku.strip().lower()
    if url_key:
        prefix = f"{url_key.strip().lower()}-"
        if sku_norm.startswith(prefix):
            model = sku_norm[len(prefix):]
            return model or None

    if "-" in sku_norm:
        suffix = sku_norm.split("-", 1)[1]
        return suffix or None

    return None


def normalize_compare_text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", html.unescape(str(value)).strip())


def decimal_equal(left, right):
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    return Decimal(str(left)) == Decimal(str(right))


def get_brand_by_url_key(conn, url_key):
    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, name, url_key FROM "v0"."ptbrd" WHERE url_key = %s',
            (url_key.strip().lower(),),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "name": row[1], "url_key": row[2]}


def load_db_products_for_brand(conn, ptbrands_id):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT url, title, ref_no, model, price, product_id, sku, price_actual
            FROM "v0"."ptprd"
            WHERE ptbrands_id = %s
            """,
            (ptbrands_id,),
        )
        return {
            row[0]: {
                "url": row[0],
                "title": row[1],
                "ref_no": row[2],
                "model": row[3],
                "price": row[4],
                "product_id": row[5],
                "sku": row[6],
                "price_actual": row[7],
            }
            for row in cur.fetchall()
        }


def build_product_record(
    *,
    ptbrands_id,
    ptbrd_url_key,
    product_id,
    title,
    url,
    image_url,
    ref_no,
    sku,
    model,
    price_list,
    price_actual,
):
    return {
        "ptbrands_id": ptbrands_id,
        "ptbrd_url_key": ptbrd_url_key,
        "product_id": product_id,
        "title": title,
        "url": url,
        "image_url": image_url or "",
        "ref_no": ref_no or "",
        "model": model,
        "price_list": price_list,
        "price_actual": price_actual,
        "sku": sku or "",
        # Legacy keys used by upsert/scrape loop
        "product_title": title,
        "product_url": url,
        "price": price_list,
    }


def compare_brand_products(scraped_products, db_by_url, brand_info):
    scraped_by_url = {p["url"]: p for p in scraped_products}
    scraped_urls = set(scraped_by_url)
    db_urls = set(db_by_url)

    missing = []
    for url in sorted(scraped_urls - db_urls):
        item = scraped_by_url[url]
        missing.append({"url": url, "title": item.get("title"), "sku": item.get("sku")})

    extra = []
    for url in sorted(db_urls - scraped_urls):
        item = db_by_url[url]
        extra.append({"url": url, "title": item.get("title"), "product_id": item.get("product_id")})

    price_changed = []
    ref_no_changed = []
    title_changed = []
    ref_no_long = []

    for url in sorted(scraped_urls & db_urls):
        scraped = scraped_by_url[url]
        db_item = db_by_url[url]

        if not decimal_equal(scraped.get("price_list"), db_item.get("price")):
            price_changed.append(
                {
                    "url": url,
                    "sku": scraped.get("sku"),
                    "scraped": float(scraped["price_list"]) if scraped.get("price_list") is not None else None,
                    "db": float(db_item["price"]) if db_item.get("price") is not None else None,
                }
            )

        if normalize_compare_text(scraped.get("ref_no")) != normalize_compare_text(db_item.get("ref_no")):
            ref_no_changed.append(
                {
                    "url": url,
                    "sku": scraped.get("sku"),
                    "scraped": scraped.get("ref_no"),
                    "db": db_item.get("ref_no"),
                }
            )

        if normalize_compare_text(scraped.get("title")) != normalize_compare_text(db_item.get("title")):
            title_changed.append(
                {
                    "url": url,
                    "sku": scraped.get("sku"),
                    "scraped": scraped.get("title"),
                    "db": db_item.get("title"),
                }
            )

        ref_no = scraped.get("ref_no") or ""
        if len(ref_no) > REF_NO_WARN_LENGTH:
            ref_no_long.append(
                {
                    "url": url,
                    "sku": scraped.get("sku"),
                    "length": len(ref_no),
                    # Display-only ellipsis in JSON report; scraped ref_no stays full length.
                    "ref_no": ref_no[:120] + ("..." if len(ref_no) > 120 else ""),
                }
            )

    return {
        "brand": brand_info["url_key"],
        "brand_name": brand_info["name"],
        "ptbrands_id": brand_info["id"],
        "scraped_count": len(scraped_products),
        "db_count": len(db_by_url),
        "missing": missing,
        "extra": extra,
        "price_changed": price_changed,
        "ref_no_changed": ref_no_changed,
        "title_changed": title_changed,
        "ref_no_over_80_chars": ref_no_long,
    }


def print_brand_report(report):
    print(f"\n{'=' * 60}")
    print(f"Brand: {report['brand']} ({report['brand_name']})")
    print(f"Scraped: {report['scraped_count']} | DB: {report['db_count']}")
    print(f"Missing in DB: {len(report['missing'])}")
    print(f"Extra in DB: {len(report['extra'])}")
    print(f"Price changed: {len(report['price_changed'])}")
    print(f"Ref.No changed: {len(report['ref_no_changed'])}")
    print(f"Title changed: {len(report['title_changed'])}")
    if report["ref_no_over_80_chars"]:
        print(f"Ref.No > {REF_NO_WARN_LENGTH} chars: {len(report['ref_no_over_80_chars'])}")

    def _sample(items, label, limit=3):
        if not items:
            return
        print(f"  Sample {label}:")
        for item in items[:limit]:
            print(f"    - {item}")

    _sample(report["missing"], "missing")
    _sample(report["extra"], "extra")
    _sample(report["price_changed"], "price_changed")
    _sample(report["ref_no_changed"], "ref_no_changed")
    _sample(report["title_changed"], "title_changed")
    _sample(report["ref_no_over_80_chars"], "long ref_no")


def save_reports_json(reports, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    serializable = []
    for report in reports:
        item = dict(report)
        for key in ("price_changed",):
            item[key] = [
                {
                    **entry,
                    "scraped": entry.get("scraped"),
                    "db": entry.get("db"),
                }
                for entry in report.get(key, [])
            ]
        serializable.append(item)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(serializable, f, ensure_ascii=False, indent=2, default=str)

    print(f"\n✓ Report saved: {output_path}")


def load_state(project_dir):
    """Son durumu yükle."""
    state_file = project_dir / "data" / "manufacturer_products" / ".scrape_state.json"
    if state_file.exists():
        with open(state_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"last_manufacturer_index": -1, "completed_manufacturers": []}


def save_state(project_dir, state):
    """Durumu kaydet."""
    state_file = project_dir / "data" / "manufacturer_products" / ".scrape_state.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def parse_products_from_html(html_content, manufacturer_url, manufacturer_name, url_key=None, ptbrands_id=None):
    """HTML içeriğinden ürünleri çek."""
    products = []
    brand_slug = url_key or manufacturer_url.replace(BASE_URL, "").strip("/").split("?")[0].lower()

    product_pattern_old = re.compile(
        r"<h1[^>]*>(?:<img[^>]*>\s*)?<strong>([^<]+)</strong></h1>.*?"
        r"<h2[^>]*><label>Ref\.?\s*No:</label>\s*([^<]+)</h2>.*?"
        r'<span class=\"?price old-price\"?>(\d+[\d\s.,]*)\s*',
        re.DOTALL | re.IGNORECASE,
    )

    blocks = re.split(r'class=[\"\']?product-item[\"\']?', html_content)[1:]
    if len(blocks) > 0:
        for block in blocks:
            title_match = re.search(
                r'href=[\"\']?([^\"\'>\s]+)[\"\']?[^>]*title=[\"\']([^\"\']+)[\"\']',
                block,
                re.IGNORECASE,
            )
            if not title_match:
                continue

            href = title_match.group(1).strip()
            title = html.unescape(title_match.group(2).strip())
            title = re.sub(r"\siçin ayrıntıları göster.*", "", title, flags=re.IGNORECASE).strip()

            old_price_match = re.search(
                r'class=[\"\']?price old-price[\"\']?[^>]*>([^<]+)</span>',
                block,
                re.IGNORECASE,
            )
            actual_price_match = re.search(
                r'class=[\"\']?price actual-price[\"\']?[^>]*>([^<]+)</span>',
                block,
                re.IGNORECASE,
            )

            price_list = parse_price(old_price_match.group(1) if old_price_match else None)
            price_actual = parse_price(actual_price_match.group(1) if actual_price_match else None)

            if price_list is None and price_actual is not None:
                price_list = price_actual

            if price_list is None and price_actual is None:
                continue

            ref_no = ""
            explicit_ref_match = re.search(
                r'<div class=[\"\']?product-detail[\"\']?>\s*<label>Ref\.?\s*No:</label>\s*(.*?)</div>',
                block,
                re.IGNORECASE | re.DOTALL,
            )
            if explicit_ref_match:
                ref_no = html.unescape(explicit_ref_match.group(1).strip())
            else:
                legacy_ref_match = re.search(
                    r'<h2 class=[\"\']?product-detail[^>]*>\s*<label>Ref\.?\s*No:</label>(.*?)</h2>',
                    block,
                    re.IGNORECASE | re.DOTALL,
                )
                if legacy_ref_match:
                    ref_no = html.unescape(legacy_ref_match.group(1).strip())

            if not ref_no and "," in title:
                parts = title.split(" ")
                ref_parts = []
                for part in reversed(parts):
                    if any(c.isdigit() for c in part) or "," in part:
                        ref_parts.insert(0, part.strip(","))
                    else:
                        break

                if ref_parts and len(ref_parts) < len(parts):
                    ref_no = ", ".join([r for r in ref_parts if r])
                    title = title.replace(", ".join(ref_parts), "").strip().strip(",")
                    title = title.replace(",".join(ref_parts), "").strip().strip(",")

            if not ref_no:
                last_word_match = re.search(r"\s+([A-Za-z0-9\-]{5,})$", title)
                if last_word_match and any(c.isdigit() for c in last_word_match.group(1)):
                    ref_no = last_word_match.group(1)
                    title = title[: last_word_match.start()].strip()

            sku = ""
            sku_match = re.search(r'<div class=[\"\']?sku[\"\']?>([^<]+)</div>', block, re.IGNORECASE)
            if sku_match:
                sku = html.unescape(sku_match.group(1).strip())

            model = derive_model_from_sku(sku, brand_slug)

            image_url = ""
            img_matches = re.findall(r"<img[^>]+>", block, re.IGNORECASE)
            for img_tag in img_matches:
                for attr in ("data-lazyloadsrc", "data-src", "src"):
                    attr_match = re.search(
                        rf'{attr}=["\']?([^\s"\'<>]+)["\']?',
                        img_tag,
                        re.IGNORECASE,
                    )
                    if attr_match:
                        img_src = attr_match.group(1).strip()
                        if not img_src or "no-image" in img_src.lower() or "placeholder" in img_src.lower():
                            continue
                        if "_200.png" in img_src.lower():
                            continue
                        if img_src.startswith("/"):
                            image_url = f"{BASE_URL}{img_src}"
                        elif img_src.startswith("http"):
                            image_url = img_src
                        else:
                            image_url = f"{BASE_URL}/{img_src}"
                        break
                if image_url:
                    break

            if not href.startswith("/"):
                href = "/" + href

            product_id = href.strip("/")

            products.append(
                build_product_record(
                    ptbrands_id=ptbrands_id,
                    ptbrd_url_key=brand_slug,
                    product_id=product_id,
                    title=title,
                    url=f"{BASE_URL}{href}",
                    image_url=image_url,
                    ref_no=ref_no,
                    sku=sku,
                    model=model,
                    price_list=price_list,
                    price_actual=price_actual,
                )
            )

        return products

    for match in product_pattern_old.finditer(html_content):
        title = html.unescape(match.group(1).strip())
        ref_no = html.unescape(match.group(2).strip())
        price_list = parse_price(match.group(3).strip())

        match_start = match.start()
        match_end = match.end()
        search_start = max(0, match_start - 800)
        search_window = html_content[search_start : match_end + 200]

        url_patterns = [
            r"href=([/-][^\s>]+-" + r"(\d+)" + r")[^\s>]*",
            r'href="(/[^-]+-[^-]+-(\\d+))"',
        ]

        product_url = manufacturer_url
        product_id = ""

        for pattern in url_patterns:
            link_matches = list(re.finditer(pattern, search_window))
            for lm in link_matches:
                href = lm.group(1)
                if href.startswith("/") and not href.startswith("//"):
                    slug = manufacturer_name.lower().replace(" ", "-")
                    if slug in href or any(c.isdigit() for c in href.split("-")[-1] if c.isdigit()):
                        product_url = BASE_URL + href
                        product_id = lm.group(2)
                        break
            if product_id:
                break

        if not product_id:
            product_id = ref_no if ref_no else str(hash(title))

        sku_match = re.search(r'<div class=[\"\']?sku[\"\']?>([^<]+)</div>', search_window, re.IGNORECASE)
        sku = html.unescape(sku_match.group(1).strip()) if sku_match else ""
        model = derive_model_from_sku(sku, brand_slug)

        products.append(
            build_product_record(
                ptbrands_id=ptbrands_id,
                ptbrd_url_key=brand_slug,
                product_id=product_id,
                title=title,
                url=product_url,
                image_url="",
                ref_no=ref_no,
                sku=sku,
                model=model,
                price_list=price_list,
                price_actual=None,
            )
        )

    return products


def fetch_products_page(session, manufacturer_url, page_number, proxy_rotator=None):
    """Belirli bir sayfadaki ürünleri çek. Hata durumunda proxy rotate eder."""
    url = f"{manufacturer_url}?pagesize={PAGE_SIZE}&pagenumber={page_number}"

    max_proxy_attempts = max(len(proxy_rotator.proxies), 1) * 2 if proxy_rotator else 1
    attempts = 0

    while attempts < max_proxy_attempts:
        attempts += 1
        try:
            response = session.get(url, timeout=60)
            response.raise_for_status()

            # Sunucu 200 dönse bile hata sayfası olabilir
            body = response.text
            if "internal error occurred" in body.lower() or "dahili bir teknik hata" in body.lower():
                print(f"  Sayfa {page_number}: Sunucu hata sayfası döndürdü")
                if proxy_rotator and proxy_rotator.proxies:
                    proxy_rotator.rotate()
                    apply_proxy_to_session(session, proxy_rotator.current)
                    print(f"  Proxy değiştirildi, tekrar deneniyor... (deneme {attempts}/{max_proxy_attempts})")
                    time.sleep(REQUEST_DELAY)
                    continue
                return None

            if proxy_rotator:
                proxy_rotator.report_success()
            return body

        except requests.exceptions.RequestException as e:
            print(f"  Sayfa {page_number} çekilirken hata: {e}")

            if proxy_rotator and proxy_rotator.proxies:
                proxy_rotator.rotate()
                apply_proxy_to_session(session, proxy_rotator.current)
                print(f"  Proxy değiştirildi, tekrar deneniyor... (deneme {attempts}/{max_proxy_attempts})")
                time.sleep(REQUEST_DELAY)
                continue

            return None

    print(f"  Sayfa {page_number}: Tüm proxy'ler denendi, başarısız.")
    return None


def get_existing_product_ids(conn, manufacturer_id):
    """DB'den bu üreticinin mevcut ürün ID'lerini çek."""
    with conn.cursor() as cur:
        cur.execute(
            'SELECT product_id FROM "v0"."ptprd" WHERE ptbrands_id = %s',
            (manufacturer_id,),
        )
        return {row[0] for row in cur.fetchall()}


def fetch_all_brand_products(session, brand_info, proxy_rotator=None):
    """Tek markanın tüm sayfalarını çek (DB yazmadan)."""
    url = f"{BASE_URL}/{brand_info['url_key']}"
    all_products = []
    page = 1
    consecutive_errors = 0

    while consecutive_errors < 3:
        html_content = fetch_products_page(session, url, page, proxy_rotator=proxy_rotator)
        if html_content is None:
            consecutive_errors += 1
            time.sleep(REQUEST_DELAY * 2)
            continue

        if "ürün bulunamadı" in html_content.lower() or "no products" in html_content.lower():
            break

        products = parse_products_from_html(
            html_content,
            url,
            brand_info["name"],
            url_key=brand_info["url_key"],
            ptbrands_id=brand_info["id"],
        )

        if not products:
            if page == 1:
                break
            consecutive_errors += 1
            continue

        consecutive_errors = 0
        all_products.extend(products)
        page += 1
        time.sleep(REQUEST_DELAY)

    return all_products


def validate_brand(session, conn, brand_info, proxy_rotator=None):
    print(f"\nValidating brand: {brand_info['url_key']} ({brand_info['name']})")
    scraped_products = fetch_all_brand_products(session, brand_info, proxy_rotator=proxy_rotator)
    db_by_url = load_db_products_for_brand(conn, brand_info["id"])
    report = compare_brand_products(scraped_products, db_by_url, brand_info)
    print_brand_report(report)
    return report


def get_parcatedarik_image_rows(conn, manufacturer_id):
    """Products whose image_url still points at parcatedarik.com."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, product_id, image_url
            FROM "v0"."ptprd"
            WHERE ptbrands_id = %s
              AND image_url IS NOT NULL
              AND image_url ILIKE %s
            """,
            (manufacturer_id, "%parcatedarik.com%"),
        )
        return [
            {"id": row[0], "product_id": row[1], "image_url": row[2]}
            for row in cur.fetchall()
        ]


def upload_brand_images_only(
    session,
    conn,
    manufacturer,
    *,
    workers=6,
    dry_run=False,
):
    """Phase B: upload images for rows still pointing at parcatedarik.com."""
    name = manufacturer["name"]
    url = manufacturer["url"]
    url_key = url.replace(BASE_URL, "").strip("/").split("?")[0].lower()

    print(f"\n{'=' * 60}")
    print(f"Görsel yükleme: {name}")
    print(f"URL: {url}")
    print(f"{'=' * 60}")

    brand_info = get_brand_by_url_key(conn, url_key)
    if not brand_info:
        print("  Marka DB'de bulunamadı, atlanıyor.")
        return name

    manufacturer_id = brand_info["id"]
    rows = get_parcatedarik_image_rows(conn, manufacturer_id)
    if not rows:
        print("  Yüklenecek parcatedarik görseli yok.")
        return name

    print(f"  Yüklenecek görsel: {len(rows)} (workers={workers})")
    if dry_run:
        print("  Dry-run: görsel yüklenmeyecek")
        return name

    image_uploader = PtProductImageUploader(session=session)
    print(f"  Image upload: enabled (bucket={image_uploader.bucket}/ptprd)")

    batch_size = max(120, workers * 20)
    updated = 0

    for offset in range(0, len(rows), batch_size):
        batch = rows[offset : offset + batch_size]
        resolve_items = [
            {
                "key": row["product_id"],
                "source_url": row["image_url"],
                "brand_url_key": url_key,
                "product_id": row["product_id"],
                "existing_image_url": row["image_url"],
            }
            for row in batch
        ]
        resolved = image_uploader.resolve_batch(resolve_items, max_workers=workers)

        with conn.cursor() as cur:
            for row in batch:
                new_url = resolved.get(row["product_id"])
                if new_url and new_url != row["image_url"]:
                    cur.execute(
                        'UPDATE "v0"."ptprd" SET image_url = %s, updated_at = NOW() WHERE id = %s',
                        (new_url, row["id"]),
                    )
                    updated += 1
        conn.commit()
        print(f"  Batch {offset // batch_size + 1}: {len(batch)} işlendi, {updated} güncellendi")

    stats = image_uploader.stats
    print(f"  Sonuç: {updated} görsel URL güncellendi")
    print(
        f"  Görseller: uploaded={stats.uploaded} skipped={stats.skipped} "
        f"failed={stats.failed} no_source={stats.no_source}"
    )
    return name


def scrape_manufacturer(
    session,
    conn,
    project_dir,
    manufacturer,
    start_page=1,
    full_rescan=False,
    proxy_rotator=None,
    dry_run=False,
    upload_images=False,
    workers=1,
):
    """Tek bir üreticinin tüm ürünlerini çek ve DB'ye yaz."""
    name = manufacturer["name"]
    url = manufacturer["url"]

    print(f"\n{'=' * 60}")
    print(f"Üretici: {name}")
    print(f"URL: {url}")
    print(f"{'=' * 60}")

    url_key = url.replace(BASE_URL, "").strip("/").split("?")[0].lower()
    image_uploader = None
    if upload_images and not dry_run:
        image_uploader = PtProductImageUploader(session=session)
        print(
            f"  Image upload: enabled (bucket={image_uploader.bucket}/ptprd, workers={workers})"
        )

    # Üreticiyi DB'ye ekle/güncelle
    if dry_run:
        manufacturer_id = None
        brand_info = get_brand_by_url_key(conn, url_key)
        if brand_info:
            manufacturer_id = brand_info["id"]
        print("  Dry-run: DB yazılmayacak")
    else:
        manufacturer_id = ensure_manufacturer_in_db(conn, name, url)
        print(f"  DB manufacturer_id: {manufacturer_id}")

    # Mevcut ürün ID'lerini al
    existing_ids = set()
    if manufacturer_id and not dry_run:
        existing_ids = get_existing_product_ids(conn, manufacturer_id)
        if existing_ids:
            print(f"  DB'de mevcut: {len(existing_ids)} ürün")
            if full_rescan:
                start_page = 1
                print("  Tam tarama modu -> Sayfa 1'den başlanıyor")
            elif start_page == 1:
                start_page = (len(existing_ids) // PAGE_SIZE) + 1
                print(f"  Kaldığı yerden devam ediliyor -> Sayfa {start_page}")

    page = start_page
    consecutive_errors = 0
    total_new = 0
    total_updated = 0

    while consecutive_errors < 3:
        print(f"  Sayfa {page} çekiliyor...")

        html_content = fetch_products_page(session, url, page, proxy_rotator=proxy_rotator)

        if html_content is None:
            consecutive_errors += 1
            time.sleep(REQUEST_DELAY * 2)
            continue

        if (
            "ürün bulunamadı" in html_content.lower()
            or "no products" in html_content.lower()
        ):
            print(f"  Sayfa {page}: Ürün yok, işlem tamamlandı.")
            break

        products = parse_products_from_html(
            html_content,
            url,
            name,
            url_key=url_key,
            ptbrands_id=manufacturer_id,
        )

        if not products:
            if page == start_page and start_page == 1:
                print(f"  Sayfa {page}: Ürün bulunamadı, tamamlandı.")
                break
            consecutive_errors += 1
            continue

        consecutive_errors = 0

        page_new = 0
        page_updated = 0
        page_skipped = 0

        resolved_images = {}
        if upload_images and image_uploader and workers > 1:
            product_urls = [
                p.get("product_url") or p.get("url", "")
                for p in products
                if p.get("product_id")
            ]
            existing_by_url = fetch_existing_image_urls_by_urls(conn, product_urls)
            resolve_items = []
            for product in products:
                pid = product.get("product_id")
                if not pid:
                    continue
                source_url = product.get("image_url")
                if not source_url:
                    continue
                product_url = product.get("product_url") or product.get("url", "")
                resolve_items.append(
                    {
                        "key": pid,
                        "source_url": source_url,
                        "brand_url_key": url_key,
                        "product_id": pid,
                        "existing_image_url": existing_by_url.get(product_url),
                    }
                )
            if resolve_items:
                resolved_images = image_uploader.resolve_batch(
                    resolve_items, max_workers=workers
                )

        for product in products:
            pid = product.get("product_id")
            if not pid:
                continue

            is_new = pid not in existing_ids
            result = upsert_product(
                conn,
                manufacturer_id,
                product,
                dry_run=dry_run,
                upload_images=upload_images,
                image_uploader=image_uploader,
                brand_url_key=url_key,
                pre_resolved_image_url=resolved_images.get(pid),
            )

            if dry_run:
                continue

            if is_new:
                page_new += 1
                existing_ids.add(pid)
            elif isinstance(result, tuple) and result[0] == "skipped":
                page_skipped += 1
            else:
                page_updated += 1

        if not dry_run:
            conn.commit()

        total_new += page_new
        total_updated += page_updated

        print(
            f"  Sayfa {page}: {page_new} yeni, {page_updated} güncellendi, "
            f"{page_skipped} skip (Toplam: {len(existing_ids)})"
        )

        page += 1
        time.sleep(REQUEST_DELAY)

    print(f"  Sonuç: {total_new} yeni ürün, {total_updated} güncelleme")
    if image_uploader is not None:
        stats = image_uploader.stats
        print(
            f"  Görseller: uploaded={stats.uploaded} skipped={stats.skipped} "
            f"failed={stats.failed} no_source={stats.no_source}"
        )
    return name


def main():
    """Ana fonksiyon."""
    global REQUEST_DELAY, PAGE_SIZE

    parser = argparse.ArgumentParser(description="ParcaTedarik ürün çekme scripti")
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="İstekler arası bekleme süresi (saniye)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Paralel görsel indirme/yükleme worker sayısı (varsayılan: 6)",
    )
    parser.add_argument(
        "--manufacturer", type=str, help="Sadece belirli üreticiyi çek (isim veya URL slug)"
    )
    parser.add_argument(
        "--brand-url-key",
        type=str,
        help="Tek veya virgülle ayrılmış ptbrd url_key (örn. 3rg,borgwarner)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scrape yap ama DB'ye yazma",
    )
    parser.add_argument(
        "--upload-images",
        action="store_true",
        default=None,
        help="ParcaTedarik görsellerini storage bucket'a yükle (varsayılan: dry-run/validate dışında açık)",
    )
    parser.add_argument(
        "--no-upload-images",
        action="store_true",
        help="Görsel yükleme kapalı (sadece parcatedarik URL'si kaydedilir)",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Scrape + DB karşılaştırması yap, yazma (validate ile aynı)",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Scrape edilen veriyi DB ile karşılaştır, yazma",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        help="Validation raporunu JSON dosyasına yaz (varsayılan: scripts/output/validation-<timestamp>.json)",
    )
    parser.add_argument(
        "--reset", action="store_true", help="Tüm durumu sıfırla ve baştan başla"
    )
    parser.add_argument(
        "--full-rescan",
        action="store_true",
        help="Sayfa 1'den başlayarak tüm ürünleri tekrar tara (image güncelleme vb.)",
    )
    parser.add_argument(
        "--pagesize",
        type=int,
        default=120,
        help="Sayfa başına ürün sayısı (varsayılan: 120)",
    )
    parser.add_argument(
        "--proxy",
        type=str,
        help="HTTP/SOCKS proxy URL (örn: http://user:pass@host:port veya socks5://host:port)",
    )
    parser.add_argument(
        "--proxy-file",
        type=str,
        help="Proxy listesi dosyası (satır başına bir proxy URL). Hata durumunda otomatik rotate eder.",
    )
    args = parser.parse_args()

    REQUEST_DELAY = args.delay
    PAGE_SIZE = args.pagesize

    project_dir = get_project_dir()

    print("=" * 60)
    print("ParcaTedarik.com Ürün Verisi Çekme Scripti (DB Modu)")
    print("=" * 60)
    print(f"\nBaşlangıç zamanı: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # DB bağlantısı
    conn = get_db_connection()
    print("✓ Veritabanı bağlantısı kuruldu")

    # Proxy rotator oluştur
    proxy_rotator = None
    if args.proxy_file:
        proxy_rotator = ProxyRotator.from_file(args.proxy_file)
        if not proxy_rotator.proxies:
            print("Uyarı: Proxy dosyasında geçerli proxy bulunamadı!")
            proxy_rotator = None

    initial_proxy = None
    if proxy_rotator and proxy_rotator.current:
        initial_proxy = proxy_rotator.current
        print(f"✓ Aktif proxy: {_mask_proxy(initial_proxy)}")
    elif args.proxy:
        initial_proxy = args.proxy
        # Tek proxy varsa rotator'a da ekle (hata mesajları için)
        proxy_rotator = ProxyRotator([args.proxy])
        print(f"✓ Proxy ayarlandı: {_mask_proxy(args.proxy)}")

    session = setup_session(proxy=initial_proxy)

    validation_mode = args.validate or args.report_only
    if args.no_upload_images:
        upload_images = False
    elif args.upload_images:
        upload_images = True
    else:
        upload_images = not args.dry_run and not validation_mode

    brand_url_keys = []
    if args.brand_url_key:
        brand_url_keys = [k.strip().lower() for k in args.brand_url_key.split(",") if k.strip()]

    if validation_mode:
        if not brand_url_keys:
            print("Hata: --validate/--report-only için --brand-url-key gerekli")
            conn.close()
            return

        reports = []
        for url_key in brand_url_keys:
            brand_info = get_brand_by_url_key(conn, url_key)
            if not brand_info:
                print(f"Uyarı: url_key bulunamadı: {url_key}")
                continue
            reports.append(validate_brand(session, conn, brand_info, proxy_rotator=proxy_rotator))

        if reports:
            output_path = args.output_json
            if not output_path:
                ts = datetime.now().strftime("%Y%m%d-%H%M%S")
                output_path = project_dir / "scripts" / "output" / f"validation-{ts}.json"
            save_reports_json(reports, output_path)

            print("\n" + "=" * 60)
            print("VALIDATION SUMMARY")
            print("=" * 60)
            for report in reports:
                print(
                    f"{report['brand']}: scraped={report['scraped_count']} db={report['db_count']} "
                    f"missing={len(report['missing'])} extra={len(report['extra'])} "
                    f"priceΔ={len(report['price_changed'])} refΔ={len(report['ref_no_changed'])} "
                    f"titleΔ={len(report['title_changed'])}"
                )

        print(f"\nTamamlandı: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        conn.close()
        return

    if args.reset:
        print("\n!!! DURUM SIFIRLANIYOR !!!")
        state_file = (
            project_dir / "data" / "manufacturer_products" / ".scrape_state.json"
        )
        if state_file.exists():
            state_file.unlink()
        print("Durum sıfırlandı.")

    # --brand-url-key veya --manufacturer ile tek/marka çekimi
    if brand_url_keys:
        for url_key in brand_url_keys:
            brand_info = get_brand_by_url_key(conn, url_key)
            if not brand_info:
                print(f"Uyarı: url_key bulunamadı: {url_key}")
                continue
            target = {
                "name": brand_info["name"],
                "url": f"{BASE_URL}/{brand_info['url_key']}",
            }
            print(f"\nSadece '{brand_info['name']}' ({url_key}) çekilecek.")
            scrape_manufacturer(
                session,
                conn,
                project_dir,
                target,
                full_rescan=args.full_rescan,
                proxy_rotator=proxy_rotator,
                dry_run=args.dry_run,
                upload_images=upload_images,
                workers=args.workers,
            )
        print(f"\nTamamlandı: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        conn.close()
        return

    if args.manufacturer:
        name = args.manufacturer.strip()
        url = make_manufacturer_url(name)
        target = {"name": name, "url": url}

        print(f"\nSadece '{name}' çekilecek.")
        print(f"URL: {url}")

        scrape_manufacturer(
            session,
            conn,
            project_dir,
            target,
            full_rescan=args.full_rescan,
            proxy_rotator=proxy_rotator,
            dry_run=args.dry_run,
            upload_images=upload_images,
            workers=args.workers,
        )
        print(f"\nTamamlandı: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        conn.close()
        return

    # Tüm üreticileri çek: CSV → Site → DB sırasıyla dene
    manufacturers = load_manufacturers_from_csv(project_dir)

    if not manufacturers:
        # CSV yoksa siteden çekmeyi dene (başarılı olursa CSV'ye kaydeder)
        manufacturers = fetch_manufacturers_from_site(session, project_dir, proxy_rotator=proxy_rotator)

    if not manufacturers:
        # Siteden de çekemediyse DB'den yükle
        manufacturers = load_manufacturers_from_db(conn)

    if not manufacturers:
        print("Üretici bulunamadı! CSV, site veya DB'den üretici listesi alınamadı.")
        conn.close()
        return

    print(f"\nToplam üretici: {len(manufacturers)}")

    state = load_state(project_dir)

    if args.full_rescan:
        # Tam tarama modunda completed'ı temizle ama manufacturer index'i koru
        # Böylece kesilirse kaldığı üreticiden devam edebilir
        start_index = state.get("last_manufacturer_index", -1) + 1 if state.get("full_rescan_mode") else 0
        completed = []
        state["full_rescan_mode"] = True
        save_state(project_dir, state)
        print(f"\nTam tarama modu: Üreticiler sayfa 1'den taranacak (başlangıç: {start_index})")
    else:
        start_index = state.get("last_manufacturer_index", -1) + 1
        completed = state.get("completed_manufacturers", [])

    print(f"\nSon durum: {start_index}. üreticiden devam")
    print(f"Tamamlanan: {len(completed)} üretici")

    for i, manufacturer in enumerate(manufacturers):
        if i < start_index:
            continue

        if not args.full_rescan and manufacturer["name"] in completed:
            print(
                f"\n[{i + 1}/{len(manufacturers)}] {manufacturer['name']} (ATLANDI - zaten tamamlandı)"
            )
            continue

        print(f"\n[{i + 1}/{len(manufacturers)}] İşleniyor: {manufacturer['name']}")

        try:
            scrape_manufacturer(
                session,
                conn,
                project_dir,
                manufacturer,
                full_rescan=args.full_rescan,
                proxy_rotator=proxy_rotator,
                dry_run=args.dry_run,
                upload_images=upload_images,
                workers=args.workers,
            )

            state["last_manufacturer_index"] = i
            if manufacturer["name"] not in completed:
                completed.append(manufacturer["name"])
            state["completed_manufacturers"] = completed
            save_state(project_dir, state)

        except KeyboardInterrupt:
            print("\n\nİşlem durduruldu!")
            print(f"Son durum kaydedildi: {i + 1}. üretici")
            save_state(project_dir, state)
            conn.close()
            return

        except Exception as e:
            print(f"HATA: {e}")
            try:
                if conn.closed:
                    print("Bağlantı koptu, yeniden bağlanılıyor...")
                    conn = get_db_connection()
                else:
                    conn.rollback()
            except Exception:
                print("Bağlantı koptu, yeniden bağlanılıyor...")
                conn = get_db_connection()
            print("Devam ediliyor...")
            time.sleep(5)

    # Tam tarama bitti — flag'i temizle, normal modda kaldığı yerden devam edebilsin
    if args.full_rescan:
        state.pop("full_rescan_mode", None)
        save_state(project_dir, state)

    print("\n" + "=" * 60)
    print("TÜM ÜRETİCİLER TAMAMLANDI!")
    print(f"Bitiş zamanı: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
