"""
Google AI Modu yanitini ayristirir.

Sorgu, Google'a formati DIKTE ediyor (bkz. config query_template):
    parça adı: "<ad>"
    oem no: <MARKA KOD, MARKA KOD, ...>

Cevap sayfasinda hem PROMPT (bizim ornek/talimat) hem de CEVAP gorunur.
Ikisinde de "parça adı:" / "oem no:" satiri vardir. Bu yuzden her etiketin
SON gecisini aliriz = gercek cevap (prompt yukarida kalir).

Ek zorluklar:
  * Iki kelimeli marka: "RENAULT TRUCKS 7421190824"
  * Sona yapisan atif metni: "VOLVO 21955032 Spareto" -> Spareto atilir
  * Uzun liste satir ortasindan kirilir (marka bir satirda, kodu sonrakinde)

Etiket bulunamazsa (Google formata uymadiysa) blok-tespit yontemine duseriz.
"""

import re
from dataclasses import dataclass, field
from typing import Optional


# --- Etiketler ---
# Bastaki markdown/madde isaretlerine (*, #, -, •, >) toleransli.
_NAME_LABEL = re.compile(r"^[\s*#>\-•]*par[çc]a\s*ad[ıiİI]\s*:\**\s*(.*)$", re.IGNORECASE)
_OEM_LABEL = re.compile(r"^[\s*#>\-•]*oem\s*(?:no|numaras[ıi])?\s*:\**\s*(.*)$", re.IGNORECASE)

# --- OEM kodu / marka tanima ---
_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9\-./]{3,}$")
_BRAND_WORD = re.compile(r"^[A-Z][A-Z0-9\-&/.]*$")

# Strict token (fallback blok-tespiti icin): "MARKA KOD" tam eslesme
_OEM_TOKEN = re.compile(
    r"^([A-Z][A-Z0-9\-&/. ]*?[A-Z])\s+([A-Z0-9][A-Z0-9\-./]{2,})$"
)
_BARE_CODE = re.compile(r"^[A-Z0-9][A-Z0-9\-./]{2,}$")

_SKU_LINE = re.compile(
    r"SKU\s*:\s*(?P<sku>[^·•|]+?)\s*[·•|]\s*part\s*:\s*(?P<part>\S+)",
    re.IGNORECASE,
)
_NOTE_LINE = re.compile(r"^\s*\(?\s*not\s*:", re.IGNORECASE)
_HAS_LETTER = re.compile(r"[a-zA-ZçğıöşüÇĞİÖŞÜ]")

# Prompt'un talimat/yer-tutucu metnini yanlislikla isim sanmayi engeller.
# (Google cevapta "parça adı:" satiri uretmezse parser prompt satirina duser.)
_PROMPT_ECHO = re.compile(
    r"(e-ticaret için|şu sırayla|örnek biçim|örn[:\s]|başlığı yaz|"
    r"\[\s*marka|\[\s*par[çc]a|<[^>]{0,40}>)",
    re.IGNORECASE,
)


@dataclass
class ParsedResult:
    name: Optional[str] = None
    oems: list = field(default_factory=list)
    sku: Optional[str] = None
    part: Optional[str] = None
    raw: str = ""

    @property
    def oem_strings(self) -> list:
        return [f"{o['brand']} {o['code']}".strip() for o in self.oems]

    @property
    def is_usable(self) -> bool:
        return bool(self.name) and len(self.oems) > 0


def _nb(s: str) -> str:
    return (s or "").replace(" ", " ")


def _clean(line: str) -> str:
    return _nb(line).strip().strip(",").strip()


def _looks_code(t: str) -> bool:
    tu = t.upper()
    return bool(_CODE_RE.match(tu)) and any(c.isdigit() for c in tu)


def _token_from_chunk(chunk: str):
    """Bir virgul-parcasindan {brand, code} cikarir. Sona yapisan atif/junk
    (ornek: 'Spareto') gormezden gelinir; iki kelimeli marka desteklenir."""
    toks = [t for t in _nb(chunk).split() if t]
    for idx, t in enumerate(toks):
        core = t.strip(".,;:()")
        if _looks_code(core):
            brand = []
            for bt in toks[:idx]:
                w = bt.strip(".,;:()")
                if _BRAND_WORD.match(w.upper()) and not any(c.isdigit() for c in w):
                    brand.append(w)
                else:
                    brand = []  # yalniz koda bitisik ardisik marka kelimeleri
            return {"brand": " ".join(brand), "code": core}
    return None


def _oems_lenient(text: str) -> list:
    out = []
    for chunk in _nb(text).split(","):
        tok = _token_from_chunk(chunk)
        if tok:
            out.append(tok)
    return _dedup(out)


def _oems_strict(text: str) -> list:
    out = []
    for chunk in text.split(","):
        c = _clean(chunk)
        m = _OEM_TOKEN.match(c) if c else None
        if m:
            out.append({"brand": re.sub(r"\s+", " ", m.group(1)).strip(),
                        "code": m.group(2).strip()})
    return out


def _dedup(oems: list) -> list:
    seen, out = set(), []
    for o in oems:
        key = (o["brand"], o["code"])
        if key not in seen:
            seen.add(key)
            out.append(o)
    return out


def _strip_quotes(s: str) -> str:
    return s.strip().strip('"“”\'').strip()


# --------------------------------------------------------------------------- #
def parse(text: str) -> ParsedResult:
    res = ParsedResult(raw=text or "")
    lines = [_nb(l) for l in (text or "").splitlines()]

    m = _SKU_LINE.search(text or "")
    if m:
        res.sku = _clean(m.group("sku"))
        res.part = _clean(m.group("part"))

    if _parse_labeled(lines, res):
        return res
    _parse_blocks(lines, res)   # etiket yoksa yedek yontem
    return res


def _parse_labeled(lines: list, res: ParsedResult) -> bool:
    """'parça adı:' / 'oem no:' etiketlerinin SON gecisini kullanir."""
    name_val, oem_idx, oem_first = None, -1, None
    for i, l in enumerate(lines):
        s = l.strip()
        mn = _NAME_LABEL.match(s)
        if mn:
            name_val = _strip_quotes(mn.group(1))
        mo = _OEM_LABEL.match(s)
        if mo:
            oem_idx, oem_first = i, mo.group(1).strip()

    if oem_idx < 0:
        return False  # etiket yok -> fallback

    buf = [oem_first] if oem_first else []
    for k in range(oem_idx + 1, len(lines)):
        s = lines[k].strip()
        if not s:
            break
        if _NAME_LABEL.match(s) or _OEM_LABEL.match(s):
            break
        cc = _clean(s)
        if _NOTE_LINE.match(cc) or _SKU_LINE.search(cc):
            break
        if re.search(r"\d", s):      # OEM devami rakam icerir; prose durur
            buf.append(s)
        else:
            break

    res.oems = _oems_lenient(" ".join(buf))
    # Yakalanan isim aslinda prompt talimati/yer-tutucusu ise reddet -> isim bos
    # kalir, ingest bos ismi yazmaz (bozuk override olusmaz).
    if name_val and _PROMPT_ECHO.search(name_val):
        name_val = None
    if name_val:
        res.name = name_val
    return bool(res.oems) or bool(name_val)


def _is_oem_line(c: str) -> bool:
    cand = _oems_strict(c)
    parts = [p for p in c.split(",") if p.strip()]
    return bool(cand) and len(cand) >= max(1, len(parts) // 2)


def _parse_blocks(lines: list, res: ParsedResult) -> None:
    """Yedek: etiketsiz cevapta ilk gercek OEM blogunu bul."""
    def is_start(c):
        return len(_oems_strict(c)) >= 2

    def is_cont(c):
        first = c.split(",")[0].strip()
        return bool(_BARE_CODE.match(first)) and bool(re.search(r"\d", first))

    start = None
    for i, line in enumerate(lines):
        c = _clean(line)
        if not c or _NOTE_LINE.match(c) or _SKU_LINE.search(c):
            continue
        if is_start(c):
            start = i
            break
    if start is None:
        return

    for j in range(start - 1, -1, -1):
        c = _clean(lines[j])
        if not c or _NOTE_LINE.match(c) or _SKU_LINE.search(c):
            continue
        if _HAS_LETTER.search(c) and not _is_oem_line(c):
            res.name = c
            break

    buf = []
    for k in range(start, len(lines)):
        c = _clean(lines[k])
        if not c:
            continue
        if _NOTE_LINE.match(c) or _SKU_LINE.search(c):
            break
        if _is_oem_line(c) or is_cont(c):
            buf.append(_nb(lines[k]).strip())
        else:
            break
    res.oems = _oems_strict(" ".join(buf))


def _alnum(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _norm_with_map(text: str):
    """Metni yalniz-alfasayisal buyuk-harfe indirger; her normal karakterin
    orijinal metindeki konumunu da tutar (geri haritalama)."""
    chars, idx_map = [], []
    for i, ch in enumerate(text):
        if ch.isalnum():
            chars.append(ch.upper())
            idx_map.append(i)
    return "".join(chars), idx_map


def _is_label_text(s: str) -> bool:
    s = (s or "").lower()
    return ("parça ad" in s or "parca ad" in s
            or bool(re.search(r"oem\s*(no|numar)", s)))


def _answer_pos(text: str, norm_text: str, idx_map: list, pn: str) -> int:
    """part_no'nun CEVAP icindeki konumu: part_no satirinin kalani YA DA hemen
    sonraki DOLU satir bir etiket ('parça adı'/'oem no') ise orasi cevaptir.
    Prompt yankisinda part_no'yu baska bir part_no satiri izler (etiket degil),
    boylece yanki elenir. Bulunamazsa -1."""
    if not pn:
        return -1
    start = 0
    while True:
        j = norm_text.find(pn, start)
        if j < 0:
            return -1
        orig = idx_map[j]
        seg_lines = text[orig:orig + 300].splitlines()
        cur_line = seg_lines[0] if seg_lines else ""
        next_line = ""
        for ln in seg_lines[1:5]:
            if ln.strip():
                next_line = ln.strip()
                break
        if _is_label_text(cur_line) or _is_label_text(next_line):
            return orig
        start = j + 1


def _parse_batch_blocks(text: str, items: list) -> list:
    """Yedek: '### / etiket bloklu' batch cevabini ayristirir (part_no ile eslestirir)."""
    text = text or ""
    norm_text, idx_map = _norm_with_map(text)
    starts = []
    for i, it in enumerate(items):
        pos = _answer_pos(text, norm_text, idx_map, _alnum(it.get("part_no")))
        starts.append((pos, i))
    found = sorted((pos, i) for pos, i in starts if pos >= 0)
    results = [ParsedResult() for _ in items]
    for k, (pos, i) in enumerate(found):
        end = found[k + 1][0] if k + 1 < len(found) else len(text)
        results[i] = parse(text[pos:end])
    return results


def _parse_table(text: str, items: list) -> list:
    """TABLO batch cevabini ayristirir (ONERILEN format).

    Google tabloyu innerText'te TAB-ayrik veriyor:
        kod <TAB> parça adı <TAB> oem no
        ABA 25506390 <TAB> ABA Triger... <TAB> 04B109244B, 04L109243G
    Her satiri kod hucresindeki part_no ile urune eslestirir.
    """
    text = text or ""
    rows = []   # (kod_token_set, name, oem_cell)
    for line in text.splitlines():
        if "\t" not in line:
            continue
        cells = [c.strip() for c in line.split("\t")]
        if len(cells) < 2:
            continue
        kod = cells[0]
        toks = {_alnum(t) for t in re.split(r"\s+", kod) if t}
        if not any(re.search(r"\d", t or "") for t in toks):
            continue  # baslik satiri (kod/parça adı/oem no) -> atla
        name = cells[1] if len(cells) >= 2 else ""
        oem_cell = cells[2] if len(cells) >= 3 else ""
        rows.append({"toks": toks, "name": name, "oem": oem_cell, "used": False})

    results = []
    for it in items:
        pn = _alnum(it.get("part_no"))
        chosen = None
        for r in rows:
            if not r["used"] and pn and pn in r["toks"]:
                chosen = r
                break
        if chosen is None:
            results.append(ParsedResult())
            continue
        chosen["used"] = True
        pr = ParsedResult()
        pr.name = chosen["name"].strip() or None
        pr.oems = _oems_lenient(chosen["oem"])
        results.append(pr)
    return results


def parse_batch(text: str, items: list) -> list:
    """Tek sorguda cok parca yanitini ayristirir. items sirasinda ParsedResult.

    Once TABLO (tab-ayrik) formatini dener (onerilen; gercek veri boyle geliyor);
    tablo bulunamazsa eski '### / etiket bloklu' yonteme duser.
    """
    res = _parse_table(text, items)
    if any(r.oems or r.name for r in res):
        return res
    return _parse_batch_blocks(text, items)


if __name__ == "__main__":
    cases = {
        "ETIKETLI (prompt yankisi + cevap)": """Google
AI Modu
Sana vereceğim parça numarasına istinaden aşağıdaki formatta bana dönüş yap:
parça adı: "Renault 1.5 dCi Rulmanlı Debriyaj Seti"
oem no: RENAULT 7701476934, RENAULT 7701476001
ELRING 10PK1342
parça adı: "Renault ve Volvo Ağır Vasıta V-Kanallı Alternatör/Fan Kayışı"
oem no: RENAULT TRUCKS 7421190824, RENAULT TRUCKS 7422100459, VOLVO
20983634, VOLVO 21955032 Spareto
Bir sonraki parça numarasını veya kontrol etmek istediğiniz OEM kodunu iletebilirsiniz.""",
        "ETIKETSIZ (yedek blok yontemi)": """Ana içeriğe geç
ELRING 10PK1342
Volvo / Renault Kamyon V-Kanallı Vantilatör Kayışı (10PK1342)
RENAULT 7421100459, RENAULT 7421190824, VOLVO 20983634, VOLVO 21955032
(Not: 10PK1342 kodlu bu ürün...)""",
    }
    for title, txt in cases.items():
        r = parse(txt)
        print(f"\n=== {title} ===")
        print("AD :", r.name)
        print("OEM:", r.oem_strings, f"({len(r.oems)})")
