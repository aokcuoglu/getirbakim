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
- PostgreSQL parcatedarik şemasına yazar
- Fiyat değişikliklerini price_history tablosuna kaydeder
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


BASE_URL = "https://parcatedarik.com"
PAGE_SIZE = 120
REQUEST_DELAY = 2.0
MAX_RETRIES = 3


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

    # Supabase pooler URL'sinden pgbouncer parametresini çıkar
    # ve doğrudan bağlantı portu kullan (5432 yerine 6543 pooler portu)
    # psycopg2 transaction mode pooler ile çalışabilir
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
            'SELECT name, url_key FROM "parcatedarik"."manufacturer" ORDER BY name'
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
            'SELECT id FROM "parcatedarik"."manufacturer" WHERE url_key = %s',
            (url_key,),
        )
        row = cur.fetchone()
        if row:
            return row[0]

        # Yoksa ekle
        cur.execute(
            """
            INSERT INTO "parcatedarik"."manufacturer" (name, url_key, created_at, updated_at)
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


def upsert_product(conn, manufacturer_id, product_data):
    """
    Ürünü DB'ye ekle veya güncelle.
    Fiyat değişikliği varsa price_history'ye de kaydet.
    """
    product_id = product_data.get("product_id", "")
    if not product_id:
        return None

    title = product_data.get("product_title", "")
    url = product_data.get("product_url", "")
    image_url = product_data.get("image_url", "") or None
    ref_no = product_data.get("ref_no", "") or None

    # Fiyatı parse et
    price_raw = product_data.get("price", "")
    price = parse_price(price_raw)

    with conn.cursor() as cur:
        # Mevcut ürünü URL üzerinden kontrol et (Çünkü script product_id uydurabiliyor, URL kesin eşsiz)
        cur.execute(
            'SELECT id, price, image_url FROM "parcatedarik"."product" WHERE url = %s',
            (url,),
        )
        existing = cur.fetchone()

        if existing:
            existing_id, existing_price, existing_image_url = existing

            needs_update = False

            # image_url güncellenmesi gerekiyor mu?
            if image_url and not existing_image_url:
                cur.execute(
                    """
                    UPDATE "parcatedarik"."product"
                    SET image_url = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (image_url, existing_id),
                )
                needs_update = True

            # Fiyat değişikliği varsa güncelle ve history'ye kaydet
            if price is not None and existing_price != price:
                cur.execute(
                    """
                    UPDATE "parcatedarik"."product"
                    SET price = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (price, existing_id),
                )
                cur.execute(
                    """
                    INSERT INTO "parcatedarik"."price_history" (product_id, price, recorded_at)
                    VALUES (%s, %s, NOW())
                    """,
                    (existing_id, price),
                )
                needs_update = True

            if not needs_update:
                return ("skipped", existing_id)

            return ("updated", existing_id)
        else:
            # Yeni ürün ekle
            cur.execute(
                """
                INSERT INTO "parcatedarik"."product"
                    (manufacturer_id, product_id, title, url, image_url, ref_no, price, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (url) DO UPDATE
                    SET title = EXCLUDED.title,
                        product_id = EXCLUDED.product_id,
                        image_url = EXCLUDED.image_url,
                        ref_no = EXCLUDED.ref_no,
                        price = EXCLUDED.price,
                        updated_at = NOW()
                RETURNING id
                """,
                (manufacturer_id, product_id, title, url, image_url, ref_no, price),
            )
            new_id = cur.fetchone()[0]

            # İlk fiyatı da history'ye kaydet
            if price is not None:
                cur.execute(
                    """
                    INSERT INTO "parcatedarik"."price_history" (product_id, price, recorded_at)
                    VALUES (%s, %s, NOW())
                    """,
                    (new_id, price),
                )

            return new_id


def parse_price(price_str):
    """Fiyat string'ini Decimal'e çevir."""
    if not price_str:
        return None

    # "1.234,56 TL" -> "1234.56"
    cleaned = price_str.replace("TL", "").strip()
    cleaned = cleaned.replace(".", "").replace(",", ".")
    # Boşlukları temizle
    cleaned = cleaned.replace(" ", "")

    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


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


def parse_products_from_html(html_content, manufacturer_url, manufacturer_name):
    """HTML içeriğinden ürünleri çek."""
    products = []

    # Eski detay stili (Bazı sayfalarda h1+strong ve h2+RefNo yapısı var)
    product_pattern_old = re.compile(
        r"<h1[^>]*>(?:<img[^>]*>\s*)?<strong>([^<]+)</strong></h1>.*?"
        r"<h2[^>]*><label>Ref\.?\s*No:</label>\s*([^<]+)</h2>.*?"
        r'<span class=\"?price old-price\"?>(\d+[\d\s.,]*)\s*',
        re.DOTALL | re.IGNORECASE,
    )

    # Yeni Grid Stili (class="product-item" içeren bloklar)
    blocks = re.split(r'class=[\"\']?product-item[\"\']?', html_content)[1:]
    if len(blocks) > 0:
        for block in blocks:
            # Sadece ürün bloklarını al, sayfa altı kısımlarında hata olmaması için
            title_match = re.search(r'href=[\"\']?([^\"\'>\s]+)[\"\']?[^>]*title=[\"\']([^\"\']+)[\"\']', block, re.IGNORECASE)
            if not title_match:
                continue
                
            href = title_match.group(1).strip()
            title = title_match.group(2).strip()
            
            # Fiyatı bul ("old-price" veya "actual-price" olabilir)
            price_match = re.search(r'class=[\"\']?price old-price[\"\']?>([^<]+)</span>', block, re.IGNORECASE)
            if not price_match:
                price_match = re.search(r'class=[\"\']?price actual-price[\"\']?>([^<]+)</span>', block, re.IGNORECASE)
                
            if not price_match:
                continue
                
            price_raw = price_match.group(1)
            
            # Başlıkları temizle ("için ayrıntıları göster" vb. at)
            # title değişkeni şuan <a title="..."> içindeki değer. Bu genelde tam uzun isimdir.
            title = html.unescape(title)
            title = re.sub(r'\siçin ayrıntıları göster.*', '', title, flags=re.IGNORECASE).strip()
            
            ref_no = ""

            # ÖNCELİK 1: Bazı sayfalarda <h2 class="product-detail hidden-on-mobile"> <label>Ref. No:</label>... </h2> var
            explicit_ref_match = re.search(r'<h2 class=[\"\']?product-detail[^>]*>\s*<label>Ref\.?\s*No:</label>(.*?)</h2>', block, re.IGNORECASE | re.DOTALL)
            if explicit_ref_match:
                ref_no = html.unescape(explicit_ref_match.group(1).strip())
            
            # ÖNCELİK 2: Eğer explicit etiket yoksa (örn. 4u) Grid view'de Ref No bazen tam başlığın sonunda virgülle ayrılmış olarak bulunur
            # Örn title attribute: "4u 1603357 Rot Mili 1603264, 1603357, 93181229"
            if not ref_no and ',' in title:
                parts = title.split(' ')
                ref_parts = []
                for p in reversed(parts):
                    if any(c.isdigit() for c in p) or ',' in p:
                        ref_parts.insert(0, p.strip(','))
                    else:
                        break
                
                if ref_parts and len(ref_parts) < len(parts):
                    ref_no = ", ".join([r for r in ref_parts if r])
                    # Ürün adını temizle
                    title = title.replace(", ".join(ref_parts), "").strip().strip(',')
                    title = title.replace(",".join(ref_parts), "").strip().strip(',')

            # ÖNCELİK 3: Alternatif son kelime sayı barındırıyorsa
            if not ref_no:
                last_word_match = re.search(r'\s+([A-Za-z0-9\-]{5,})$', title)
                if last_word_match and any(c.isdigit() for c in last_word_match.group(1)):
                    ref_no = last_word_match.group(1)
                    title = title[:last_word_match.start()].strip()

            # Resim URL'sini bul — data-lazyloadsrc öncelikli (lazy-load gerçek resim)
            # Marka logosu değil ürün resmini almak için data-lazyloadsrc'yi tercih et
            image_url = ""
            img_matches = re.findall(r'<img[^>]+>', block, re.IGNORECASE)
            for img_tag in img_matches:
                # Önce data-lazyloadsrc, sonra data-src, en son src dene
                for attr in ('data-lazyloadsrc', 'data-src', 'src'):
                    attr_match = re.search(rf'{attr}=["\']?([^\s"\'<>]+)["\']?', img_tag, re.IGNORECASE)
                    if attr_match:
                        img_src = attr_match.group(1).strip()
                        # Logo/placeholder filtrele — _200.png genelde marka logosu
                        if not img_src or 'no-image' in img_src.lower() or 'placeholder' in img_src.lower():
                            continue
                        if '_200.png' in img_src.lower():
                            continue
                        if img_src.startswith('/'):
                            image_url = f"{BASE_URL}{img_src}"
                        elif img_src.startswith('http'):
                            image_url = img_src
                        else:
                            image_url = f"{BASE_URL}/{img_src}"
                        break
                if image_url:
                    break

            # Link düzeltme
            if not href.startswith('/'):
                href = '/' + href

            product_id = href.strip("/")

            # '&#x20BA;' gibi karakterleri temizle
            price = html.unescape(price_raw.strip()).replace(" TL", "").replace("₺", "").strip()

            products.append({
                "product_id": product_id,
                "product_title": title,
                "product_url": f"{BASE_URL}{href}",
                "image_url": image_url,
                "ref_no": ref_no,  # Çıkarılan referans kodlarını kullan
                "price": f"{price} TL",
            })
        
        return products

    # Eğer grid yoksa eski yapıyı kullan
    for match in product_pattern_old.finditer(html_content):
        title = html.unescape(match.group(1).strip())
        ref_no = html.unescape(match.group(2).strip())
        price = match.group(3).strip().replace(".", "").replace(",", ".")

        match_start = match.start()
        match_end = match.end()
        search_start = max(0, match_start - 800)
        search_window = html_content[search_start : match_end + 200]

        url_patterns = [
            r"href=([/-][^\s>]+-"
            + r"(\d+)"
            + r")[^\s>]*",
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
                    if slug in href or any(
                        c.isdigit() for c in href.split("-")[-1] if c.isdigit()
                    ):
                        product_url = BASE_URL + href
                        product_id = lm.group(2)
                        break
            if product_id:
                break

        if not product_id:
            # Yedek ID olarak ref_no veya title hash'ini kullan
            product_id = ref_no if ref_no else str(hash(title))

        product = {
            "product_id": product_id,
            "product_title": title,
            "product_url": product_url,
            "image_url": "",
            "ref_no": ref_no,
            "price": f"{price} TL",
        }
        products.append(product)

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
            'SELECT product_id FROM "parcatedarik"."product" WHERE manufacturer_id = %s',
            (manufacturer_id,),
        )
        return {row[0] for row in cur.fetchall()}


def scrape_manufacturer(session, conn, project_dir, manufacturer, start_page=1, full_rescan=False, proxy_rotator=None):
    """Tek bir üreticinin tüm ürünlerini çek ve DB'ye yaz."""
    name = manufacturer["name"]
    url = manufacturer["url"]

    print(f"\n{'=' * 60}")
    print(f"Üretici: {name}")
    print(f"URL: {url}")
    print(f"{'=' * 60}")

    # Üreticiyi DB'ye ekle/güncelle
    manufacturer_id = ensure_manufacturer_in_db(conn, name, url)
    print(f"  DB manufacturer_id: {manufacturer_id}")

    # Mevcut ürün ID'lerini al
    existing_ids = get_existing_product_ids(conn, manufacturer_id)
    if existing_ids:
        print(f"  DB'de mevcut: {len(existing_ids)} ürün")
        # full_rescan modunda sayfa 1'den başla (image güncellemesi için)
        if full_rescan:
            start_page = 1
            print(f"  Tam tarama modu -> Sayfa 1'den başlanıyor")
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

        products = parse_products_from_html(html_content, url, name)

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

        for product in products:
            pid = product.get("product_id")
            if not pid:
                continue

            is_new = pid not in existing_ids
            result = upsert_product(conn, manufacturer_id, product)

            if is_new:
                page_new += 1
                existing_ids.add(pid)
            elif isinstance(result, tuple) and result[0] == "skipped":
                page_skipped += 1
            else:
                page_updated += 1

        conn.commit()

        total_new += page_new
        total_updated += page_updated

        print(
            f"  Sayfa {page}: {page_new} yeni, {page_updated} image güncellendi, "
            f"{page_skipped} skip (Toplam: {len(existing_ids)})"
        )

        page += 1
        time.sleep(REQUEST_DELAY)

    print(f"  Sonuç: {total_new} yeni ürün, {total_updated} güncelleme")
    return name


def main():
    """Ana fonksiyon."""
    global REQUEST_DELAY, PAGE_SIZE

    parser = argparse.ArgumentParser(description="ParcaTedarik ürün çekme scripti")
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="İstekler arası bekleme süresi (saniye)",
    )
    parser.add_argument(
        "--manufacturer", type=str, help="Sadece belirli üreticiyi çek (isim veya URL slug)"
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

    if args.reset:
        print("\n!!! DURUM SIFIRLANIYOR !!!")
        state_file = (
            project_dir / "data" / "manufacturer_products" / ".scrape_state.json"
        )
        if state_file.exists():
            state_file.unlink()
        print("Durum sıfırlandı.")

    # --manufacturer ile tek üretici çekiliyorsa CSV gerekmez
    if args.manufacturer:
        name = args.manufacturer.strip()
        url = make_manufacturer_url(name)
        target = {"name": name, "url": url}

        print(f"\nSadece '{name}' çekilecek.")
        print(f"URL: {url}")

        scrape_manufacturer(session, conn, project_dir, target, full_rescan=args.full_rescan, proxy_rotator=proxy_rotator)
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
            scrape_manufacturer(session, conn, project_dir, manufacturer, full_rescan=args.full_rescan, proxy_rotator=proxy_rotator)

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
