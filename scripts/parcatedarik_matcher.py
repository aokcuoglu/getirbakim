#!/usr/bin/env python3
"""
ParcaTedarik → Supplier Products Eslestirme Scripti
====================================================
parcatedarik.product tablolundaki urunleri supplier_products ile eslestirir.
Eslesen kayitlara image_url aktarir ve ref_no'daki OEM kodlarini
supplier_product_oems tablosuna ekler.

Kullanim:
    python parcatedarik_matcher.py
    python parcatedarik_matcher.py --dry-run --limit 100
    python parcatedarik_matcher.py --manufacturer "BLUE PRINT"

Gerekli kutuphaneler:
    pip install psycopg2-binary python-dotenv
"""

import re
import argparse
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Gerekli kutuphane bulunamadi.")
    print("Kurulum icin: pip install psycopg2-binary")
    exit(1)

try:
    from dotenv import dotenv_values
except ImportError:
    print("Gerekli kutuphane bulunamadi.")
    print("Kurulum icin: pip install python-dotenv")
    exit(1)


def get_project_dir():
    return Path(__file__).parent.parent


def get_db_url():
    project_dir = get_project_dir()
    env_file = project_dir / ".env.local"
    if not env_file.exists():
        print(f"Hata: {env_file} bulunamadi!")
        exit(1)
    env_values = dotenv_values(env_file)
    db_url = env_values.get("DATABASE_URL")
    if not db_url:
        print("Hata: DATABASE_URL .env.local dosyasinda bulunamadi!")
        exit(1)
    return db_url.replace("?pgbouncer=true", "")


def get_db_connection():
    db_url = get_db_url()
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        return conn
    except psycopg2.Error as e:
        print(f"Veritabani baglanti hatasi: {e}")
        exit(1)


def normalize_key(value):
    """Alfanumerik disini sil, uppercase yap. JS normalizeKey ile ayni."""
    if not value:
        return ""
    return re.sub(r"[^a-zA-Z0-9]", "", value).upper()


def extract_part_number(title, manufacturer_name):
    """
    Title'dan parca numarasini cikar.
    Format: "{MANUFACTURER_NAME} {PART_NUMBER} {aciklama...}"
    Dondurdugu deger: normalize_key(manufacturer_name) + normalize_key(part_number)
    Bu, supplier_products.normalized_sku ile dogrudan eslesir.
    """
    if not title or not manufacturer_name:
        return None

    title_upper = title.upper().strip()
    mfr_upper = manufacturer_name.upper().strip()

    if not title_upper.startswith(mfr_upper):
        return None

    remainder = title[len(manufacturer_name):].strip()
    if not remainder:
        return None

    # Ilk bosluk-ayrilmis token parca numarasidir
    parts = remainder.split()
    if not parts:
        return None

    part_number = parts[0].strip()
    # Cok kisa tokenleri atla (1-2 karakter muhtemelen parca numarasi degil)
    if len(part_number) < 3:
        return None

    # normalized_sku = brand + part_number (birlesik, normalize edilmis)
    return normalize_key(manufacturer_name) + normalize_key(part_number)


def parse_oem_codes(ref_no):
    """ref_no'yu virgulden ayir, bosluklari temizle."""
    if not ref_no:
        return []
    codes = [c.strip() for c in ref_no.split(",")]
    return [c for c in codes if c and len(c) >= 2]


def ensure_provider(conn):
    """PARCATEDARIK provider'i olustur veya guncelle, id dondur."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO public.supplier_providers (code, name, status, priority, created_at, updated_at)
        VALUES ('PARCATEDARIK', 'ParcaTedarik', 'ACTIVE', 100, NOW(), NOW())
        ON CONFLICT (code) DO UPDATE SET updated_at = NOW()
        RETURNING id
        """,
    )
    provider_id = cur.fetchone()[0]
    conn.commit()
    print(f"Provider PARCATEDARIK id={provider_id}")
    return provider_id


def build_normalized_sku_index(conn):
    """supplier_products tablosundan normalized_sku index'i olustur."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, provider_id, normalized_sku, image_url
        FROM public.supplier_products
        WHERE normalized_sku IS NOT NULL AND normalized_sku != ''
        """
    )
    index = {}
    count = 0
    for row in cur:
        sp_id, provider_id, norm_sku, img_url = row
        key = norm_sku.upper()
        if key not in index:
            index[key] = []
        index[key].append({
            "id": sp_id,
            "provider_id": provider_id,
            "image_url": img_url,
        })
        count += 1
    print(f"SKU index yuklendi: {count} supplier_product, {len(index)} unique normalized_sku")
    return index


def fetch_parcatedarik_products(conn, manufacturer_filter=None, limit=None):
    """parcatedarik urunlerini manufacturer bilgisiyle getir."""
    cur = conn.cursor()
    query = """
        SELECT p.id, p.title, p.image_url, p.ref_no, m.name as manufacturer_name
        FROM parcatedarik.product p
        JOIN parcatedarik.manufacturer m ON p.manufacturer_id = m.id
        WHERE p.title IS NOT NULL AND p.title != ''
    """
    params = []
    if manufacturer_filter:
        query += " AND UPPER(m.name) = UPPER(%s)"
        params.append(manufacturer_filter)
    query += " ORDER BY p.id"
    if limit:
        query += " LIMIT %s"
        params.append(limit)

    cur.execute(query, params)
    return cur.fetchall()


def main():
    parser = argparse.ArgumentParser(description="ParcaTedarik -> Supplier Products eslestirme")
    parser.add_argument("--dry-run", action="store_true", help="Yazma islemi yapma, sadece goster")
    parser.add_argument("--limit", type=int, default=None, help="Islenen urun sayisini sinirla")
    parser.add_argument("--manufacturer", type=str, default=None, help="Belirli bir ureticiyi isle")
    args = parser.parse_args()

    if args.dry_run:
        print("*** DRY RUN - degisiklik yapilmayacak ***")

    conn = get_db_connection()

    try:
        # Provider olustur
        if not args.dry_run:
            parcatedarik_provider_id = ensure_provider(conn)
        else:
            print("(dry-run) Provider olusturma atlandi")

        # SKU index'i yukle
        sku_index = build_normalized_sku_index(conn)

        # parcatedarik urunlerini getir
        products = fetch_parcatedarik_products(conn, args.manufacturer, args.limit)
        total = len(products)
        print(f"\nparcatedarik urun sayisi: {total}")

        # Sayaclar
        matched = 0
        no_part_number = 0
        no_match = 0
        images_updated = 0
        oem_inserted = 0
        batch_count = 0

        cur = conn.cursor()

        for i, (pid, title, img_url, ref_no, mfr_name) in enumerate(products):
            # Parca numarasi cikar (zaten normalize edilmis: brand+part)
            normalized = extract_part_number(title, mfr_name)
            if not normalized:
                no_part_number += 1
                continue

            matches = sku_index.get(normalized)
            if not matches:
                no_match += 1
                continue

            matched += 1

            if args.dry_run:
                if matched <= 20:
                    print(f"  ESLESTI: norm={normalized} -> {len(matches)} supplier_product")
                    if ref_no:
                        oems = parse_oem_codes(ref_no)
                        print(f"    OEM kodlari ({len(oems)}): {', '.join(oems[:5])}{'...' if len(oems) > 5 else ''}")
                continue

            # image_url guncelle (sadece parcatedarik'te varsa ve hedefte yoksa)
            if img_url:
                for sp in matches:
                    if not sp["image_url"]:
                        cur.execute(
                            """
                            UPDATE public.supplier_products
                            SET image_url = %s, updated_at = NOW()
                            WHERE id = %s AND image_url IS NULL
                            """,
                            (img_url, sp["id"]),
                        )
                        if cur.rowcount > 0:
                            images_updated += 1
                            sp["image_url"] = img_url

            # OEM kodlarini ekle
            oem_codes = parse_oem_codes(ref_no)
            for oem_code in oem_codes:
                normalized_oem = normalize_key(oem_code)
                if not normalized_oem or len(normalized_oem) < 2:
                    continue

                for sp in matches:
                    cur.execute(
                        """
                        INSERT INTO public.supplier_product_oems
                            (provider_id, supplier_product_id, oem_code, normalized_oem_code,
                             oem_brand, source, is_active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, NULL, 'PARCATEDARIK', true, NOW(), NOW())
                        ON CONFLICT (provider_id, supplier_product_id, normalized_oem_code, source)
                        DO NOTHING
                        """,
                        (sp["provider_id"], sp["id"], oem_code, normalized_oem),
                    )
                    if cur.rowcount > 0:
                        oem_inserted += 1

            # Batch commit
            batch_count += 1
            if batch_count >= 500:
                conn.commit()
                batch_count = 0

            # Ilerleme
            if (i + 1) % 2000 == 0:
                print(f"  Ilerleme: {i + 1}/{total} - eslesen: {matched}, resim: {images_updated}, oem: {oem_inserted}")

        # Son commit
        if not args.dry_run and batch_count > 0:
            conn.commit()

        # Ozet
        print(f"\n{'=== SONUC (DRY RUN) ===' if args.dry_run else '=== SONUC ==='}")
        print(f"  Toplam urun:           {total}")
        print(f"  Parca no bulunamayan:  {no_part_number}")
        print(f"  Eslesen:               {matched}")
        print(f"  Eslesmeyen:            {no_match}")
        if not args.dry_run:
            print(f"  Resim guncellenen:     {images_updated}")
            print(f"  OEM kodu eklenen:      {oem_inserted}")

    except Exception as e:
        conn.rollback()
        print(f"\nHata: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
