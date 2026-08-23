"""
OEM eleme katmani.

NOT: Bu, kuyruk yazicisindaki (ref-suggestions.ts) elemenin bir on-kopyasidir.
Kuyruk zaten ayni elemeyi tekrar uygular; buradaki amac erken temizlik ve
review dosyasinin daha temiz gorunmesi. Nihai otorite kuyruk tarafidir.

Kurallar (kullanicinin belirttigi gibi):
  * kod >= 5 karakter
  * kod en az bir rakam icermeli
  * urunun kendi part_no'suna esit ya da onun prefix'i olan kodlar dusurulur
"""

import re


def norm(code: str) -> str:
    """Kaba normalizasyon: harf/rakam disini at, buyut. Sadece karsilastirma icin.
    (Kuyruktaki normalizeOem() ile birebir ayni OLMAYABILIR; nihai code_norm'u
    kuyruk uretir.)"""
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def is_valid_code(code: str, part_no: str = "") -> bool:
    c = norm(code)
    if len(c) < 5:
        return False
    if not re.search(r"\d", c):
        return False
    pn = norm(part_no)
    if pn and (c == pn or c.startswith(pn) or pn.startswith(c)):
        return False
    return True


def filter_oems(oems: list, part_no: str = "") -> list:
    """oems: [{'brand':..,'code':..}] -> elenmis liste (sira + tekillik korunur)."""
    seen, out = set(), []
    for o in oems:
        if not is_valid_code(o.get("code", ""), part_no):
            continue
        key = (norm(o.get("code", "")), (o.get("brand", "") or "").upper())
        if key in seen:
            continue
        seen.add(key)
        out.append(o)
    return out


if __name__ == "__main__":
    sample = [
        {"brand": "HONDA", "code": "22105P72305"},
        {"brand": "HONDA", "code": "22105P72315"},
        {"brand": "AISIN", "code": "KH-046C"},   # part_no'ya esit -> dusmeli
        {"brand": "X", "code": "AB"},            # <5 -> dusmeli
        {"brand": "Y", "code": "ABCDE"},         # rakam yok -> dusmeli
        {"brand": "HONDA", "code": "22105P72305"},  # tekrar -> dusmeli
    ]
    for o in filter_oems(sample, part_no="KH-046C"):
        print(o)
