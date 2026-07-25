-- Web'den toplanan OEM / SEO ad önerileri için inceleme kuyruğu.
--
-- Neden ayrı tablo: kaynak public web (üretici katalogları yok, TecDoc'ta marka
-- yok, tedarikçi oem_no boş) — yani veri doğası gereği doğrulanmamış. Öneriler
-- burada kaynak URL + kanıt metniyle bekler, admin onaylayınca catalog.product_oems
-- (source='WEB') ve catalog.product_overrides.name_override'a akar. Böylece hatalı
-- bir OEM vitrine hiç çıkmaz ve her satırın nereden geldiği izlenebilir kalır.
CREATE TABLE catalog.product_ref_suggestions (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES catalog.products (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- 'OEM' | 'NAME'
  kind        TEXT NOT NULL,
  -- OEM: biçimli kod (part_oens.code gibi) · NAME: önerilen başlık
  value       TEXT NOT NULL,
  -- OEM: normalizeOem(value) · NAME: upper(btrim(value)) — tekilleştirme anahtarı
  value_norm  TEXT NOT NULL,
  -- Araç markası (OEM). product_oems ile aynı sözleşme: '' = bilinmiyor, NULL değil.
  oem_brand   TEXT NOT NULL DEFAULT '',
  -- 'HIGH' | 'MEDIUM' | 'LOW'
  confidence  TEXT NOT NULL DEFAULT 'MEDIUM',
  -- Toplayan kaynak: site alan adı ya da 'websearch' / 'derived'
  source_site TEXT NOT NULL,
  source_url  TEXT,
  -- Kodun/adın geçtiği ham metin parçası — inceleyenin karar verebilmesi için.
  evidence    TEXT,
  -- 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED'
  status      TEXT NOT NULL DEFAULT 'PENDING',
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ(6),
  reviewed_by TEXT,
  applied_at  TIMESTAMPTZ(6)
);

-- Aynı ürüne aynı kodu/adı iki kez önermeyi engeller; tekrar tarama idempotent olur.
CREATE UNIQUE INDEX uq_ref_suggestions_product_kind_value
  ON catalog.product_ref_suggestions (product_id, kind, value_norm, oem_brand);

CREATE INDEX idx_ref_suggestions_status_kind ON catalog.product_ref_suggestions (status, kind);
CREATE INDEX idx_ref_suggestions_product ON catalog.product_ref_suggestions (product_id);
