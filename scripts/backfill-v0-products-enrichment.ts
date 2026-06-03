import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

const apply = process.env.APPLY === 'true'
const limitRaw = Number.parseInt(process.env.LIMIT || '1000', 10)
const offsetRaw = Number.parseInt(process.env.OFFSET || '0', 10)
const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10_000) : 1000
const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0
const linkModeRaw = (process.env.LINK_MODE || 'all').toLowerCase()
const linkMode = ['all', 'strong', 'skip'].includes(linkModeRaw) ? linkModeRaw : 'all'
const phaseRaw = (process.env.PHASE || 'all').toLowerCase()
const phase = ['all', 'links', 'lookup'].includes(phaseRaw) ? phaseRaw : 'all'
const lookupSourceRaw = (process.env.LOOKUP_SOURCE || 'oem').toLowerCase()
const lookupSource = ['oem', 'ean', 'cross'].includes(lookupSourceRaw) ? lookupSourceRaw : 'oem'
const sourceRaw = (process.env.SOURCE || 'dnmk').toLowerCase()
const source = ['dnmk', 'bsbg', 'all'].includes(sourceRaw) ? sourceRaw : 'dnmk'

type BatchSummary = {
  scanned: number
  existingProducts: number
  missingProducts: number
}

type ProductSourceSummary = {
  product_count: number
  source_count: number
}

type CodeSignalSummary = {
  inserted_or_updated: number
}

type PublicPartLinkSummary = {
  inserted_or_updated: number
  approved_count: number
  candidate_count: number
}

type PublicPartCodeLookupSummary = {
  inserted: number
}

function addProductSourceSummaries(
  left: ProductSourceSummary,
  right: ProductSourceSummary
): ProductSourceSummary {
  return {
    product_count: left.product_count + right.product_count,
    source_count: left.source_count + right.source_count
  }
}

function addCodeSignalSummaries(
  left: CodeSignalSummary,
  right: CodeSignalSummary
): CodeSignalSummary {
  return {
    inserted_or_updated: left.inserted_or_updated + right.inserted_or_updated
  }
}

async function getDnmkBatchSummary(): Promise<BatchSummary> {
  const rows = await db.$queryRaw<
    Array<{
      scanned: number
      existing_products: number
      missing_products: number
    }>
  >(Prisma.sql`
    WITH batch AS (
      SELECT m.id, m.dnmk_products_id
      FROM v0.product_mapping m
      JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      WHERE m.mapping_status = 'APPROVED'
        AND m.dnmk_products_id IS NOT NULL
        AND d.is_passive IS DISTINCT FROM TRUE
      ORDER BY m.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    )
    SELECT
      COUNT(*)::int AS scanned,
      COUNT(ps.id)::int AS existing_products,
      (COUNT(*) - COUNT(ps.id))::int AS missing_products
    FROM batch b
    LEFT JOIN v0.product_sources ps
      ON ps.source_type = 'DNMK'
      AND ps.source_record_id = b.dnmk_products_id::text
  `)
  const row = rows[0]
  return {
    scanned: row?.scanned ?? 0,
    existingProducts: row?.existing_products ?? 0,
    missingProducts: row?.missing_products ?? 0
  }
}

async function getBsbgBatchSummary(): Promise<BatchSummary> {
  const rows = await db.$queryRaw<
    Array<{
      scanned: number
      existing_products: number
      missing_products: number
    }>
  >(Prisma.sql`
    WITH batch AS (
      SELECT b.id
      FROM v0.bsbg_products b
      WHERE b.is_passive IS DISTINCT FROM TRUE
      ORDER BY b.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    )
    SELECT
      COUNT(*)::int AS scanned,
      COUNT(ps.id)::int AS existing_products,
      (COUNT(*) - COUNT(ps.id))::int AS missing_products
    FROM batch b
    LEFT JOIN v0.product_sources ps
      ON ps.source_type = 'BSBG'
      AND ps.source_record_id = b.id::text
  `)
  const row = rows[0]
  return {
    scanned: row?.scanned ?? 0,
    existingProducts: row?.existing_products ?? 0,
    missingProducts: row?.missing_products ?? 0
  }
}

async function getBatchSummary(): Promise<BatchSummary> {
  if (source === 'bsbg') return getBsbgBatchSummary()
  if (source === 'all') {
    const [dnmk, bsbg] = await Promise.all([getDnmkBatchSummary(), getBsbgBatchSummary()])
    return {
      scanned: dnmk.scanned + bsbg.scanned,
      existingProducts: dnmk.existingProducts + bsbg.existingProducts,
      missingProducts: dnmk.missingProducts + bsbg.missingProducts
    }
  }
  return getDnmkBatchSummary()
}

async function backfillDnmkProductsAndSources(): Promise<ProductSourceSummary> {
  const rows = await db.$queryRaw<ProductSourceSummary[]>(Prisma.sql`
    WITH batch AS (
      SELECT
        m.id AS product_mapping_id,
        m.dnmk_products_id,
        m.ptdrk_products_id,
        d.stock_code,
        d.stock_name,
        d.part_no,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        d.image_url,
        db.brand AS dinamik_brand,
        p.title AS ptdrk_title,
        p.part_no AS ptdrk_part_no,
        p.sku AS ptdrk_sku,
        pb.name AS ptdrk_brand
      FROM v0.product_mapping m
      JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      LEFT JOIN v0.ptdrk_brands pb ON pb.id = p.ptdrk_brands_id
      WHERE m.mapping_status = 'APPROVED'
        AND m.dnmk_products_id IS NOT NULL
        AND d.is_passive IS DISTINCT FROM TRUE
      ORDER BY m.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    ),
    existing AS (
      SELECT
        b.*,
        ps.v0_product_id
      FROM batch b
      JOIN v0.product_sources ps
        ON ps.source_type = 'DNMK'
        AND ps.source_record_id = b.dnmk_products_id::text
    ),
    missing AS (
      SELECT
        b.*,
        nextval(pg_get_serial_sequence('v0.products', 'id'))::bigint AS v0_product_id,
        COALESCE(
          NULLIF(BTRIM(b.ptdrk_title), ''),
          NULLIF(BTRIM(b.stock_name), ''),
          NULLIF(BTRIM(b.stock_code), ''),
          NULLIF(BTRIM(b.ptdrk_part_no), ''),
          'Product ' || b.product_mapping_id::text
        ) AS display_name,
        COALESCE(NULLIF(BTRIM(b.dinamik_brand), ''), NULLIF(BTRIM(b.ptdrk_brand), '')) AS brand_name
      FROM batch b
      WHERE NOT EXISTS (
        SELECT 1
        FROM existing e
        WHERE e.dnmk_products_id = b.dnmk_products_id
      )
    ),
    inserted_products AS (
      INSERT INTO v0.products (
        id,
        display_name,
        normalized_name,
        brand_name,
        primary_image_url
      )
      SELECT
        v0_product_id,
        display_name,
        NULLIF(UPPER(REGEXP_REPLACE(display_name, '[^A-Za-z0-9]+', '', 'g')), ''),
        brand_name,
        image_url
      FROM missing
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    ),
    product_map AS (
      SELECT
        product_mapping_id,
        dnmk_products_id,
        ptdrk_products_id,
        stock_code,
        stock_name,
        dinamik_brand,
        ptdrk_title,
        ptdrk_sku,
        ptdrk_brand,
        v0_product_id
      FROM existing
      UNION ALL
      SELECT
        product_mapping_id,
        dnmk_products_id,
        ptdrk_products_id,
        stock_code,
        stock_name,
        dinamik_brand,
        ptdrk_title,
        ptdrk_sku,
        ptdrk_brand,
        v0_product_id
      FROM missing
    ),
    upsert_dnmk_sources AS (
      INSERT INTO v0.product_sources (
        v0_product_id,
        source_type,
        source_record_id,
        dnmk_products_id,
        product_mapping_id,
        source_sku,
        source_brand,
        source_name,
        is_primary
      )
      SELECT
        v0_product_id,
        'DNMK',
        dnmk_products_id::text,
        dnmk_products_id,
        product_mapping_id,
        stock_code,
        dinamik_brand,
        stock_name,
        TRUE
      FROM product_map
      ON CONFLICT (source_type, source_record_id) DO UPDATE SET
        v0_product_id = EXCLUDED.v0_product_id,
        product_mapping_id = EXCLUDED.product_mapping_id,
        source_sku = EXCLUDED.source_sku,
        source_brand = EXCLUDED.source_brand,
        source_name = EXCLUDED.source_name,
        updated_at = NOW()
      RETURNING id
    ),
    upsert_ptdrk_sources AS (
      INSERT INTO v0.product_sources (
        v0_product_id,
        source_type,
        source_record_id,
        ptdrk_products_id,
        product_mapping_id,
        source_sku,
        source_brand,
        source_name,
        is_primary
      )
      SELECT
        v0_product_id,
        'PTDRK',
        ptdrk_products_id::text,
        ptdrk_products_id,
        product_mapping_id,
        ptdrk_sku,
        ptdrk_brand,
        ptdrk_title,
        FALSE
      FROM product_map
      WHERE ptdrk_products_id IS NOT NULL
      ON CONFLICT (source_type, source_record_id) DO UPDATE SET
        v0_product_id = EXCLUDED.v0_product_id,
        product_mapping_id = EXCLUDED.product_mapping_id,
        source_sku = EXCLUDED.source_sku,
        source_brand = EXCLUDED.source_brand,
        source_name = EXCLUDED.source_name,
        updated_at = NOW()
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM inserted_products) AS product_count,
      (
        (SELECT COUNT(*) FROM upsert_dnmk_sources) +
        (SELECT COUNT(*) FROM upsert_ptdrk_sources)
      )::int AS source_count
  `)
  return rows[0] ?? { product_count: 0, source_count: 0 }
}

async function backfillBsbgProductsAndSources(): Promise<ProductSourceSummary> {
  const rows = await db.$queryRaw<ProductSourceSummary[]>(Prisma.sql`
    WITH batch AS (
      SELECT
        b.id AS bsbg_products_id,
        b.malzeme_no,
        b.part_no,
        b.aciklama,
        b.aciklama2,
        bb.brand AS bsbg_brand
      FROM v0.bsbg_products b
      JOIN v0.bsbg_brands bb ON bb.id = b.bsbg_brands_id
      WHERE b.is_passive IS DISTINCT FROM TRUE
      ORDER BY b.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    ),
    existing AS (
      SELECT
        b.*,
        ps.v0_product_id
      FROM batch b
      JOIN v0.product_sources ps
        ON ps.source_type = 'BSBG'
        AND ps.source_record_id = b.bsbg_products_id::text
    ),
    missing AS (
      SELECT
        b.*,
        nextval(pg_get_serial_sequence('v0.products', 'id'))::bigint AS v0_product_id,
        COALESCE(
          NULLIF(BTRIM(b.aciklama), ''),
          NULLIF(BTRIM(b.aciklama2), ''),
          NULLIF(BTRIM(b.part_no), ''),
          NULLIF(BTRIM(b.malzeme_no), ''),
          'Basbug Product ' || b.bsbg_products_id::text
        ) AS display_name
      FROM batch b
      WHERE NOT EXISTS (
        SELECT 1
        FROM existing e
        WHERE e.bsbg_products_id = b.bsbg_products_id
      )
    ),
    inserted_products AS (
      INSERT INTO v0.products (
        id,
        display_name,
        normalized_name,
        brand_name,
        primary_image_url
      )
      SELECT
        v0_product_id,
        display_name,
        NULLIF(UPPER(REGEXP_REPLACE(display_name, '[^A-Za-z0-9]+', '', 'g')), ''),
        bsbg_brand,
        NULL
      FROM missing
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    ),
    product_map AS (
      SELECT
        bsbg_products_id,
        malzeme_no,
        aciklama,
        bsbg_brand,
        v0_product_id
      FROM existing
      UNION ALL
      SELECT
        bsbg_products_id,
        malzeme_no,
        aciklama,
        bsbg_brand,
        v0_product_id
      FROM missing
    ),
    upsert_bsbg_sources AS (
      INSERT INTO v0.product_sources (
        v0_product_id,
        source_type,
        source_record_id,
        bsbg_products_id,
        source_sku,
        source_brand,
        source_name,
        is_primary
      )
      SELECT
        v0_product_id,
        'BSBG',
        bsbg_products_id::text,
        bsbg_products_id,
        malzeme_no,
        bsbg_brand,
        aciklama,
        TRUE
      FROM product_map
      ON CONFLICT (source_type, source_record_id) DO UPDATE SET
        v0_product_id = EXCLUDED.v0_product_id,
        bsbg_products_id = EXCLUDED.bsbg_products_id,
        source_sku = EXCLUDED.source_sku,
        source_brand = EXCLUDED.source_brand,
        source_name = EXCLUDED.source_name,
        updated_at = NOW()
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM inserted_products) AS product_count,
      (SELECT COUNT(*)::int FROM upsert_bsbg_sources) AS source_count
  `)
  return rows[0] ?? { product_count: 0, source_count: 0 }
}

async function backfillProductsAndSources(): Promise<ProductSourceSummary> {
  if (source === 'bsbg') return backfillBsbgProductsAndSources()
  if (source === 'all') {
    const dnmk = await backfillDnmkProductsAndSources()
    const bsbg = await backfillBsbgProductsAndSources()
    return addProductSourceSummaries(dnmk, bsbg)
  }
  return backfillDnmkProductsAndSources()
}

async function backfillDnmkCodeSignals(): Promise<CodeSignalSummary> {
  const rows = await db.$queryRaw<CodeSignalSummary[]>(Prisma.sql`
    WITH batch AS (
      SELECT
        m.id AS product_mapping_id,
        m.dnmk_products_id,
        m.ptdrk_products_id,
        d.stock_code,
        d.part_no AS dinamik_part_no,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        p.ref_no AS ptdrk_ref_no,
        p.part_no AS ptdrk_part_no,
        p.sku AS ptdrk_sku,
        dnmk_source.v0_product_id,
        dnmk_source.id AS dnmk_source_id,
        ptdrk_source.id AS ptdrk_source_id
      FROM v0.product_mapping m
      JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      JOIN v0.product_sources dnmk_source
        ON dnmk_source.source_type = 'DNMK'
        AND dnmk_source.source_record_id = m.dnmk_products_id::text
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      LEFT JOIN v0.product_sources ptdrk_source
        ON ptdrk_source.source_type = 'PTDRK'
        AND ptdrk_source.source_record_id = m.ptdrk_products_id::text
      WHERE m.mapping_status = 'APPROVED'
        AND m.dnmk_products_id IS NOT NULL
        AND d.is_passive IS DISTINCT FROM TRUE
      ORDER BY m.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    ),
    raw_signals AS (
      SELECT
        v0_product_id,
        dnmk_source_id AS product_source_id,
        'DNMK'::text AS source_type,
        dnmk_products_id::text AS source_record_id,
        dinamik_part_no AS raw_code,
        'dnmk.part_no'::text AS origin,
        'OEM'::text AS default_kind,
        0.9200::numeric AS confidence,
        jsonb_build_object('productMappingId', product_mapping_id) AS evidence_json
      FROM batch
      WHERE NULLIF(BTRIM(dinamik_part_no), '') IS NOT NULL

      UNION ALL
      SELECT v0_product_id, dnmk_source_id, 'DNMK', dnmk_products_id::text, barcode_1, 'dnmk.barcode_1', NULL, 0.9000, jsonb_build_object('productMappingId', product_mapping_id)
      FROM batch WHERE NULLIF(BTRIM(barcode_1), '') IS NOT NULL
      UNION ALL
      SELECT v0_product_id, dnmk_source_id, 'DNMK', dnmk_products_id::text, barcode_2, 'dnmk.barcode_2', NULL, 0.8800, jsonb_build_object('productMappingId', product_mapping_id)
      FROM batch WHERE NULLIF(BTRIM(barcode_2), '') IS NOT NULL
      UNION ALL
      SELECT v0_product_id, dnmk_source_id, 'DNMK', dnmk_products_id::text, barcode_3, 'dnmk.barcode_3', NULL, 0.8600, jsonb_build_object('productMappingId', product_mapping_id)
      FROM batch WHERE NULLIF(BTRIM(barcode_3), '') IS NOT NULL
      UNION ALL
      SELECT v0_product_id, dnmk_source_id, 'DNMK', dnmk_products_id::text, stock_code, 'dnmk.stock_code', NULL, 0.7800, jsonb_build_object('productMappingId', product_mapping_id)
      FROM batch WHERE NULLIF(BTRIM(stock_code), '') IS NOT NULL
      UNION ALL
      SELECT
        b.v0_product_id,
        b.ptdrk_source_id,
        'PTDRK',
        b.ptdrk_products_id::text,
        token.raw_code,
        'ptdrk.ref_no',
        NULL,
        0.9000,
        jsonb_build_object(
          'productMappingId', b.product_mapping_id,
          'refNo', b.ptdrk_ref_no
        )
      FROM batch b
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(b.ptdrk_ref_no, ''), '[,;|/]') AS token(raw_code)
      WHERE b.ptdrk_products_id IS NOT NULL
        AND NULLIF(BTRIM(token.raw_code), '') IS NOT NULL
      UNION ALL
      SELECT v0_product_id, ptdrk_source_id, 'PTDRK', ptdrk_products_id::text, ptdrk_part_no, 'ptdrk.part_no', NULL, 0.8400, jsonb_build_object('productMappingId', product_mapping_id)
      FROM batch WHERE ptdrk_products_id IS NOT NULL AND NULLIF(BTRIM(ptdrk_part_no), '') IS NOT NULL
      UNION ALL
      SELECT v0_product_id, ptdrk_source_id, 'PTDRK', ptdrk_products_id::text, ptdrk_sku, 'ptdrk.sku', 'SKU', 0.7600, jsonb_build_object('productMappingId', product_mapping_id)
      FROM batch WHERE ptdrk_products_id IS NOT NULL AND NULLIF(BTRIM(ptdrk_sku), '') IS NOT NULL
    ),
    normalized_signals AS (
      SELECT DISTINCT ON (
        v0_product_id,
        source_type,
        source_record_id,
        normalized_code,
        origin
      )
        v0_product_id,
        product_source_id,
        source_type,
        source_record_id,
        BTRIM(raw_code) AS raw_code,
        NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') AS normalized_code,
        CASE
          WHEN default_kind IS NOT NULL THEN default_kind
          WHEN NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') ~ '^[0-9]{8,14}$' THEN 'EAN'
          WHEN NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') ~ '^[A-Z]{2,}[0-9]{3,}[A-Z0-9]*$' THEN 'OEM'
          ELSE 'CROSS_REFERENCE'
        END AS code_kind,
        origin,
        CASE
          WHEN origin = 'ptdrk.ref_no'
            AND NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') ~ '^[A-Z]{2,}[0-9]{3,}[A-Z0-9]*$'
            THEN 0.9200::numeric
          WHEN origin = 'ptdrk.ref_no'
            AND NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') ~ '^[0-9]{8,14}$'
            THEN 0.9000::numeric
          WHEN origin = 'ptdrk.ref_no' THEN 0.8200::numeric
          ELSE confidence
        END AS confidence,
        evidence_json
      FROM raw_signals
      WHERE NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') IS NOT NULL
      ORDER BY
        v0_product_id,
        source_type,
        source_record_id,
        normalized_code,
        origin,
        confidence DESC
    ),
    upserted AS (
      INSERT INTO v0.product_code_signals (
        v0_product_id,
        product_source_id,
        source_type,
        source_record_id,
        raw_code,
        normalized_code,
        code_kind,
        origin,
        confidence,
        evidence_json
      )
      SELECT
        v0_product_id,
        product_source_id,
        source_type,
        source_record_id,
        raw_code,
        normalized_code,
        code_kind,
        origin,
        confidence,
        evidence_json
      FROM normalized_signals
      ON CONFLICT (
        v0_product_id,
        source_type,
        source_record_id,
        normalized_code,
        origin
      ) DO UPDATE SET
        raw_code = EXCLUDED.raw_code,
        code_kind = EXCLUDED.code_kind,
        confidence = EXCLUDED.confidence,
        evidence_json = EXCLUDED.evidence_json,
        product_source_id = EXCLUDED.product_source_id,
        updated_at = NOW()
      RETURNING id
    )
    SELECT COUNT(*)::int AS inserted_or_updated FROM upserted
  `)
  return rows[0] ?? { inserted_or_updated: 0 }
}

async function backfillBsbgCodeSignals(): Promise<CodeSignalSummary> {
  const rows = await db.$queryRaw<CodeSignalSummary[]>(Prisma.sql`
    WITH batch AS (
      SELECT
        b.id AS bsbg_products_id,
        b.malzeme_no,
        b.part_no,
        b.oem_no,
        bsbg_source.v0_product_id,
        bsbg_source.id AS bsbg_source_id
      FROM v0.bsbg_products b
      JOIN v0.product_sources bsbg_source
        ON bsbg_source.source_type = 'BSBG'
        AND bsbg_source.source_record_id = b.id::text
      WHERE b.is_passive IS DISTINCT FROM TRUE
      ORDER BY b.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    ),
    raw_signals AS (
      SELECT
        v0_product_id,
        bsbg_source_id AS product_source_id,
        'BSBG'::text AS source_type,
        bsbg_products_id::text AS source_record_id,
        oem_no AS raw_code,
        'bsbg.oem_no'::text AS origin,
        'OEM'::text AS default_kind,
        0.9200::numeric AS confidence,
        jsonb_build_object('bsbgProductId', bsbg_products_id) AS evidence_json
      FROM batch
      WHERE NULLIF(BTRIM(oem_no), '') IS NOT NULL

      UNION ALL
      SELECT
        v0_product_id,
        bsbg_source_id,
        'BSBG',
        bsbg_products_id::text,
        part_no,
        'bsbg.part_no',
        'OEM',
        0.8600,
        jsonb_build_object('bsbgProductId', bsbg_products_id)
      FROM batch
      WHERE NULLIF(BTRIM(part_no), '') IS NOT NULL

      UNION ALL
      SELECT
        v0_product_id,
        bsbg_source_id,
        'BSBG',
        bsbg_products_id::text,
        malzeme_no,
        'bsbg.malzeme_no',
        'SKU',
        0.7800,
        jsonb_build_object('bsbgProductId', bsbg_products_id)
      FROM batch
      WHERE NULLIF(BTRIM(malzeme_no), '') IS NOT NULL
    ),
    normalized_signals AS (
      SELECT DISTINCT ON (
        v0_product_id,
        source_type,
        source_record_id,
        normalized_code,
        origin
      )
        v0_product_id,
        product_source_id,
        source_type,
        source_record_id,
        BTRIM(raw_code) AS raw_code,
        NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') AS normalized_code,
        default_kind AS code_kind,
        origin,
        confidence,
        evidence_json
      FROM raw_signals
      WHERE NULLIF(UPPER(REGEXP_REPLACE(BTRIM(raw_code), '[^A-Za-z0-9]+', '', 'g')), '') IS NOT NULL
      ORDER BY
        v0_product_id,
        source_type,
        source_record_id,
        normalized_code,
        origin,
        confidence DESC
    ),
    upserted AS (
      INSERT INTO v0.product_code_signals (
        v0_product_id,
        product_source_id,
        source_type,
        source_record_id,
        raw_code,
        normalized_code,
        code_kind,
        origin,
        confidence,
        evidence_json
      )
      SELECT
        v0_product_id,
        product_source_id,
        source_type,
        source_record_id,
        raw_code,
        normalized_code,
        code_kind,
        origin,
        confidence,
        evidence_json
      FROM normalized_signals
      ON CONFLICT (
        v0_product_id,
        source_type,
        source_record_id,
        normalized_code,
        origin
      ) DO UPDATE SET
        raw_code = EXCLUDED.raw_code,
        code_kind = EXCLUDED.code_kind,
        confidence = EXCLUDED.confidence,
        evidence_json = EXCLUDED.evidence_json,
        product_source_id = EXCLUDED.product_source_id,
        updated_at = NOW()
      RETURNING id
    )
    SELECT COUNT(*)::int AS inserted_or_updated FROM upserted
  `)
  return rows[0] ?? { inserted_or_updated: 0 }
}

async function backfillCodeSignals(): Promise<CodeSignalSummary> {
  if (source === 'bsbg') return backfillBsbgCodeSignals()
  if (source === 'all') {
    const dnmk = await backfillDnmkCodeSignals()
    const bsbg = await backfillBsbgCodeSignals()
    return addCodeSignalSummaries(dnmk, bsbg)
  }
  return backfillDnmkCodeSignals()
}

async function backfillPublicPartLinks(): Promise<PublicPartLinkSummary> {
  const signalKinds =
    linkMode === 'strong' ? ['OEM', 'EAN'] : ['OEM', 'EAN', 'CROSS_REFERENCE']
  const batchProductsSql =
    source === 'bsbg'
      ? Prisma.sql`
      SELECT DISTINCT ps.v0_product_id
      FROM v0.bsbg_products b
      JOIN v0.product_sources ps
        ON ps.source_type = 'BSBG'
        AND ps.source_record_id = b.id::text
      WHERE b.is_passive IS DISTINCT FROM TRUE
      ORDER BY ps.v0_product_id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `
      : source === 'all'
        ? Prisma.sql`
      SELECT DISTINCT v0_product_id
      FROM (
        SELECT ps.v0_product_id
        FROM v0.product_mapping m
        JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
        JOIN v0.product_sources ps
          ON ps.source_type = 'DNMK'
          AND ps.source_record_id = m.dnmk_products_id::text
        WHERE m.mapping_status = 'APPROVED'
          AND m.dnmk_products_id IS NOT NULL
          AND d.is_passive IS DISTINCT FROM TRUE

        UNION ALL

        SELECT ps.v0_product_id
        FROM v0.bsbg_products b
        JOIN v0.product_sources ps
          ON ps.source_type = 'BSBG'
          AND ps.source_record_id = b.id::text
        WHERE b.is_passive IS DISTINCT FROM TRUE
      ) source_products
      ORDER BY v0_product_id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `
        : Prisma.sql`
      SELECT DISTINCT ps.v0_product_id
      FROM v0.product_mapping m
      JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      JOIN v0.product_sources ps
        ON ps.source_type = 'DNMK'
        AND ps.source_record_id = m.dnmk_products_id::text
      WHERE m.mapping_status = 'APPROVED'
        AND m.dnmk_products_id IS NOT NULL
        AND d.is_passive IS DISTINCT FROM TRUE
      ORDER BY ps.v0_product_id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `

  const rows = await db.$queryRaw<PublicPartLinkSummary[]>(Prisma.sql`
    WITH batch_products AS (
      ${batchProductsSql}
    ),
    signals AS (
      SELECT cs.*
      FROM v0.product_code_signals cs
      JOIN batch_products bp ON bp.v0_product_id = cs.v0_product_id
      WHERE cs.code_kind IN (${Prisma.join(signalKinds)})
    ),
    candidates AS (
      SELECT
        s.v0_product_id,
        lookup.part_id,
        lookup.match_reason,
        LEAST(
          s.confidence,
          CASE
            WHEN lookup.match_reason = 'OEM_MATCH' THEN 0.9800
            WHEN lookup.match_reason = 'EAN_MATCH' THEN 0.9600
            ELSE 0.8800
          END
        )::numeric AS confidence,
        s.raw_code,
        s.normalized_code,
        s.origin,
        lookup.matched_code
      FROM signals s
      JOIN v0.public_part_code_lookup lookup
        ON lookup.code_kind = s.code_kind
        AND lookup.normalized_code = s.normalized_code
    ),
    grouped AS (
      SELECT
        v0_product_id,
        part_id,
        STRING_AGG(DISTINCT match_reason, '+' ORDER BY match_reason) AS match_reason,
        MAX(confidence) AS confidence,
        BOOL_OR(match_reason IN ('OEM_MATCH', 'EAN_MATCH')) AS has_strong_match,
        JSONB_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'rawCode', raw_code,
            'normalizedCode', normalized_code,
            'origin', origin,
            'matchType', match_reason,
            'matchedCode', matched_code
          )
        ) AS codes
      FROM candidates
      GROUP BY v0_product_id, part_id
    ),
    scored AS (
      SELECT
        grouped.*,
        COUNT(*) OVER (PARTITION BY v0_product_id) AS candidate_count
      FROM grouped
    ),
    upserted AS (
      INSERT INTO v0.product_public_part_links (
        v0_product_id,
        part_id,
        status,
        match_reason,
        confidence,
        evidence_json,
        approved_at
      )
      SELECT
        v0_product_id,
        part_id,
        CASE
          WHEN candidate_count = 1 AND has_strong_match THEN 'APPROVED'
          ELSE 'CANDIDATE'
        END AS status,
        match_reason,
        confidence,
        JSONB_BUILD_OBJECT(
          'codes', codes,
          'candidateCount', candidate_count,
          'bulkBackfill', TRUE,
          'source', ${source}::text,
          'linkMode', ${linkMode}::text
        ),
        CASE
          WHEN candidate_count = 1 AND has_strong_match THEN NOW()
          ELSE NULL
        END AS approved_at
      FROM scored
      ON CONFLICT (v0_product_id, part_id) DO UPDATE SET
        status = CASE
          WHEN v0.product_public_part_links.status = 'APPROVED' THEN 'APPROVED'
          ELSE EXCLUDED.status
        END,
        match_reason = EXCLUDED.match_reason,
        confidence = GREATEST(v0.product_public_part_links.confidence, EXCLUDED.confidence),
        evidence_json = EXCLUDED.evidence_json,
        approved_at = COALESCE(v0.product_public_part_links.approved_at, EXCLUDED.approved_at),
        updated_at = NOW()
      RETURNING status
    )
    SELECT
      COUNT(*)::int AS inserted_or_updated,
      COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_count,
      COUNT(*) FILTER (WHERE status = 'CANDIDATE')::int AS candidate_count
    FROM upserted
  `)
  return rows[0] ?? { inserted_or_updated: 0, approved_count: 0, candidate_count: 0 }
}

async function backfillPublicPartCodeLookup(): Promise<PublicPartCodeLookupSummary> {
  const sourceSql =
    lookupSource === 'ean'
      ? Prisma.sql`
      SELECT
        'EAN'::text AS code_kind,
        wanted_codes.normalized_code,
        pe.part_id,
        pe.code AS matched_code,
        'EAN_MATCH'::text AS match_reason
      FROM (
        SELECT DISTINCT normalized_code
        FROM v0.product_code_signals
        WHERE code_kind = 'EAN'
        ORDER BY normalized_code ASC
        LIMIT ${limit}
        OFFSET ${offset}
      ) wanted_codes
      JOIN public.part_eans pe
        ON UPPER(REGEXP_REPLACE(pe.code, '[^A-Za-z0-9]+', '', 'g')) = wanted_codes.normalized_code
    `
      : lookupSource === 'cross'
        ? Prisma.sql`
      SELECT
        'CROSS_REFERENCE'::text AS code_kind,
        wanted_codes.normalized_code,
        pcr.part_id,
        pcr.article_number AS matched_code,
        'CROSS_REFERENCE_MATCH'::text AS match_reason
      FROM (
        SELECT DISTINCT normalized_code
        FROM v0.product_code_signals
        WHERE code_kind = 'CROSS_REFERENCE'
        ORDER BY normalized_code ASC
        LIMIT ${limit}
        OFFSET ${offset}
      ) wanted_codes
      JOIN public.part_cross_references pcr
        ON UPPER(REGEXP_REPLACE(pcr.article_number, '[^A-Za-z0-9]+', '', 'g')) = wanted_codes.normalized_code
    `
        : Prisma.sql`
      SELECT
        'OEM'::text AS code_kind,
        wanted_codes.normalized_code,
        po.part_id,
        po.code AS matched_code,
        'OEM_MATCH'::text AS match_reason
      FROM (
        SELECT DISTINCT normalized_code
        FROM v0.product_code_signals
        WHERE code_kind = 'OEM'
        ORDER BY normalized_code ASC
        LIMIT ${limit}
        OFFSET ${offset}
      ) wanted_codes
      JOIN public.part_oens po
        ON UPPER(REGEXP_REPLACE(po.code, '[^A-Za-z0-9]+', '', 'g')) = wanted_codes.normalized_code
    `

  const rows = await db.$queryRaw<PublicPartCodeLookupSummary[]>(Prisma.sql`
    WITH raw_lookup AS (
      ${sourceSql}
    ),
    inserted AS (
      INSERT INTO v0.public_part_code_lookup (
        code_kind,
        normalized_code,
        part_id,
        matched_code,
        match_reason
      )
      SELECT DISTINCT
        code_kind,
        normalized_code,
        part_id,
        matched_code,
        match_reason
      FROM raw_lookup
      WHERE normalized_code IS NOT NULL
      ON CONFLICT (
        code_kind,
        normalized_code,
        part_id,
        match_reason,
        matched_code
      ) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*)::int AS inserted FROM inserted
  `)
  return rows[0] ?? { inserted: 0 }
}

async function main() {
  const batchSummary = await getBatchSummary()

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: 'DRY_RUN',
          limit,
          offset,
          phase,
          source,
          linkMode,
          lookupSource,
          ...batchSummary,
          message:
            'Set APPLY=true to bulk-create v0.products, product_sources, code signals, and public.parts links.'
        },
        null,
        2
      )
    )
    return
  }

  const productSourceSummary =
    phase === 'links' || phase === 'lookup'
      ? { product_count: 0, source_count: 0 }
      : await backfillProductsAndSources()
  const codeSignalSummary =
    phase === 'links' || phase === 'lookup' ? { inserted_or_updated: 0 } : await backfillCodeSignals()
  const publicPartCodeLookupSummary =
    phase === 'lookup' ? await backfillPublicPartCodeLookup() : { inserted: 0 }
  const publicPartLinkSummary =
    linkMode === 'skip' || phase === 'lookup'
      ? { inserted_or_updated: 0, approved_count: 0, candidate_count: 0 }
      : await backfillPublicPartLinks()

  console.log(
    JSON.stringify(
      {
        mode: 'APPLY',
        limit,
        offset,
        phase,
        source,
        linkMode,
        lookupSource,
        ...batchSummary,
        productsInserted: productSourceSummary.product_count,
        sourcesInsertedOrUpdated: productSourceSummary.source_count,
        codeSignalsInsertedOrUpdated: codeSignalSummary.inserted_or_updated,
        publicPartCodeLookupInserted: publicPartCodeLookupSummary.inserted,
        publicPartLinksInsertedOrUpdated: publicPartLinkSummary.inserted_or_updated,
        publicPartLinksApproved: publicPartLinkSummary.approved_count,
        publicPartLinksCandidate: publicPartLinkSummary.candidate_count
      },
      null,
      2
    )
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
