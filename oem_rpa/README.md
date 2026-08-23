# OEM RPA — Web Kaynaklı OEM/İsim Öneri Üreticisi

Elindeki OEM'i olmayan kanonik ürünleri **PostgreSQL**'den okur, **Google AI
Modu**'na sorar, dönen **parça adı + OEM/çapraz-referans** listesini ayrıştırıp
eler ve senin **var olan onay kuyruğun** için doğru JSON'u üretir.

```
catalog.products        Google AI Modu        parser + eleme      ingest scripti
(product_id, brand,  ─►  (tarayıcı oto.,  ─►   (ad + OEM +     ─►  (SOURCE_SITE=
 part_no; OEM'siz)        kaynak URL'ler)       grounded)           'rpa-claude')
                                                     │                    │
                                              suggestions.json            ▼
                                                              catalog.product_ref_suggestions
                                                                     (status=PENDING)
                                                                          │
                                                    Admin > Eşleştirme > Zenginleştirme
                                                              (onay / ret)
                                                                          │
                                            ┌─────────────────────────────┴──────────────┐
                                     kind='OEM' → product_oems (source='WEB')     kind='NAME' → product_overrides.name_override
```

---

## ⚠️ Neden doğrudan yazmıyoruz (tasarımın özü)

RPA çıktısı **web çıkarımı sınıfı** bir veridir (üretici kataloğu değil) —
mevcut Gemini grounding hattıyla aynı sınıf. Ölçülen isabet ~%39 (marka bazında
%22–52). Yanlış bir OEM sadece kozmetik hata değil: `product_oems.code_norm`
tedarikçi→kanonik eşleştirmeyi (match-supplier-rows rung 2a/2b) beslediği için
**yanlış tedarikçi ürününü yanlış kanonik ürüne bağlar.**

Bu yüzden RPA `product_oems`/`product_overrides`'a **doğrudan yazmaz.** Çıktı,
zaten kurulu olan **onay kuyruğuna** (`catalog.product_ref_suggestions`, PENDING)
gider; onay/ret insan tarafından Zenginleştirme ekranında yapılır. Onaylananlar
`product_oems` (source='WEB') ve `product_overrides.name_override`'a düşer.

---

## Çıktı formatı (ingest scriptinin beklediği şekil)

`suggestions.json`, `scripts/ingest-gemini-oems.ts` kopyanın beklediği şekildedir:

```json
{
  "product_id": "cprod_123",
  "brand": "AISIN",
  "sku": "KH-046C",
  "oem_references": ["22105P72305", "22105P72315"],
  "oem_brands":     ["HONDA", "HONDA"],
  "sources": ["https://..."],
  "grounded": true,
  "product_name": "Honda Civic 1.6 3'lü Debriyaj Seti"
}
```

- **product_id ZORUNLU** — script SKU'dan tahmin etmez, product_id'siz satırı
  atlar (aynı part_no farklı markalarda tekrarlanabildiği için). Bu yüzden
  `select_query` product_id döndürmeli.
- **grounded / sources** — atıflı (kaynak URL var) → kuyrukta **MEDIUM**, atıfsız
  → **LOW** güven. Toplu onayda `--min-confidence=MEDIUM` ile LOW'u dışarıda
  bırakabilirsin.
- **product_name** — kind='NAME' önerisi için ekstra alan. (İngest scriptin
  yalnız OEM işliyorsa, name için `kind='NAME'` satırını eklemek tek satırlık
  bir değişiklik — bkz. "Sonraki adım".)

### Eleme (kuyruk katmanının bir ön-kopyası)
`src/filters.py`: kod ≥5 karakter + rakam içermeli; ürünün kendi part_no'suna
eşit/prefix olanlar düşer. Kuyruk bu elemeyi tekrar uygular; bu katman erken
temizlik içindir, nihai otorite kuyruktur.

---

## Kurulum

```bash
cd oem_rpa
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp config.example.yaml config.yaml   # gerçek config zaten dolduruldu
```

## Çalıştırma

```bash
# 1) TOPLA — DBeaver tüneli açıkken. Google'dan çeker, suggestions.json üretir.
python -m src.main --collect

# 2) INGEST — kendi scriptinle kuyruğa yaz (SOURCE_SITE='rpa-claude')
npx tsx scripts/ingest-rpa-oems.ts suggestions.json

# 3) ONAYLA — Admin > Eşleştirme > Zenginleştirme ekranından onay/ret
#    (toplu onayda --min-confidence=MEDIUM ile LOW'ları dışarıda bırak)
```

`review.csv` (opsiyonel) — göndermeden önce Excel'de hızlı göz atmak için;
kuyruk akışını değiştirmez.

---

## Sen yokken netleşen/kalan uçlar

1. **`ingest-gemini-oems.ts` kopyası:** `scripts/ingest-rpa-oems.ts` olarak
   kopyala, `SOURCE_SITE`'ı `'rpa-claude'` yap. Çıktı şekli birebir uyumlu.
2. **catalog şeması:** `config.yaml`'daki `select_query` taslak. `catalog.products`
   içinde part_no/marka sütun adları farklıysa sorguyu ona göre düzelt (ya da
   şemayı paylaş, birebir yazayım).
3. **product_name → kind='NAME':** ingest scriptin name'i işlemiyorsa,
   `insertSuggestions`'a `{kind:'NAME', value: product_name, ...}` satırı eklemek
   yeterli.

## Dosya yapısı

```
oem_rpa/
├── README.md
├── requirements.txt
├── config.example.yaml / config.yaml
├── .gitignore
└── src/
    ├── parser.py         # Google metnini ad + OEM'e çevirir (test edildi)
    ├── filters.py        # eleme katmanı (test edildi)
    ├── suggestions.py    # ingest JSON şekli (test edildi)
    ├── db.py             # PostgreSQL okuma (product_id, brand, part_no)
    ├── google_lookup.py  # Google AI Modu otomasyonu + kaynak URL yakalama
    ├── main.py           # orkestratör: collect -> suggestions.json + review.csv
    └── panel_api.py      # KULLANIM DIŞI (doğrudan yazma terk edildi)
```
