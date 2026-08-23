"""
RPA ciktisini onay kuyrugu ingest scriptinin (ingest-gemini-oems.ts kopyasi)
bekledigi JSON sekline cevirir.

Hedef sekil (kullanicinin verdigi ornek):
{
  "product_id": "...",
  "brand": "AISIN",
  "sku": "KH-046C",
  "oem_references": ["22105P72305", "22105P72315"],
  "oem_brands":     ["HONDA", "HONDA"],
  "sources": ["https://..."],
  "grounded": true,
  "product_name": "Honda ... Debriyaj Seti"   # kind='NAME' oneri icin (ekstra alan)
}

Notlar:
  * product_id ZORUNLU girdidir; kuyruk product_id'siz satiri atlar
    (ayni part_no farkli markalarda tekrar edebildigi icin bilincli karar).
  * grounded = kaynak URL var mi? -> kuyruk tarafinda MEDIUM/LOW guveni belirler
    (atifli=MEDIUM, atifsiz=LOW).
  * Eleme kuyrukta tekrar uygulanir; burada da on-eleme yapariz.
"""

import re

from .filters import filter_oems

# Jenerik SEO dolgusu (Google verisi olmayinca uretiyor):
# "ABA 25506372 Motor Yedek Parça ve Aksesuar Modelleri" gibi.
_GENERIC_NAME = re.compile(
    r"(yedek\s*par[çc]a|aksesuar|modelleri|ürünleri|urunleri|çeşitleri|"
    r"cesitleri|fiyatlar|en\s*uygun|sat[ıi]n\s*al|\bmodels?\b)",
    re.IGNORECASE,
)


def _alnum(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _is_generic_name(name: str, part_no: str) -> bool:
    """Isim aslinda 'veri yok' dolgusu mu? (part_no'yu tekrar edip jenerik
    kelimeler iceriyorsa). Gercek bir ad (marka+parca tipi+arac) part_no icermez."""
    if not name:
        return False
    pn = _alnum(part_no)
    return bool(pn) and pn in _alnum(name) and bool(_GENERIC_NAME.search(name))


def build_suggestion(product: dict, parsed, sources: list) -> dict:
    """
    product: DB satiri -> {product_id, brand, part_no(=sku), ...}
    parsed : parser.ParsedResult
    sources: yakalanan kaynak URL listesi
    """
    part_no = product.get("part_no") or product.get("sku") or ""
    clean = filter_oems(parsed.oems, part_no=part_no)

    srcs = [s for s in (sources or []) if s]
    grounded = len(srcs) > 0

    # Google veri bulamayinca jenerik dolgu ad uretiyor; onu yazma (cop override).
    name = parsed.name or ""
    if _is_generic_name(name, part_no):
        name = ""

    return {
        "product_id": product["product_id"],
        "brand": product.get("brand", ""),
        "sku": part_no,
        "oem_references": [o["code"] for o in clean],
        "oem_brands": [o.get("brand", "") for o in clean],
        "sources": srcs,
        "grounded": grounded,
        "product_name": name,
    }


def is_emittable(sug: dict) -> bool:
    """product_id yoksa ya da hicbir OEM ve isim kalmadiysa kuyruga gonderme."""
    if not sug.get("product_id"):
        return False
    return bool(sug.get("oem_references")) or bool(sug.get("product_name"))
