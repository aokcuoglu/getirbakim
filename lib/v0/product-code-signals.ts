import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  normalizeBrandName,
  normalizeCode,
  splitReferenceTokens
} from '@/lib/matching/code-normalization'
import {
  classifyRefToken,
  findPublicPartCandidatesByCode,
  type PartMatchType
} from '@/lib/matching/parcatedarik-to-parts-resolver'

export type ProductCodeKind = 'OEM' | 'EAN' | 'CROSS_REFERENCE' | 'SKU'
export type ProductCodeSourceType = 'DNMK' | 'BSBG' | 'PTDRK'

export type ProductCodeSignalInput = {
  sourceType: ProductCodeSourceType
  sourceRecordId: string
  rawCode: string
  normalizedCode: string
  codeKind: ProductCodeKind
  origin: string
  confidence: number
  evidence: Record<string, unknown>
}

export type DpmatchCodeSignalSource = {
  matchId: number
  dnmkProductId: string | bigint | null
  ptdrkProductId: number | null
  dinamikPartNo?: string | null
  dinamikBarcode1?: string | null
  dinamikBarcode2?: string | null
  dinamikBarcode3?: string | null
  dinamikStockCode?: string | null
  ptRefNo?: string | null
  ptPartNo?: string | null
  ptSku?: string | null
}

export type BasbugCodeSignalSource = {
  bsbgProductId: string | bigint
  oemNo?: string | null
  partNo?: string | null
  malzemeNo?: string | null
}

function toCodeKind(matchType: PartMatchType): ProductCodeKind {
  switch (matchType) {
    case 'OEM_MATCH':
      return 'OEM'
    case 'EAN_MATCH':
      return 'EAN'
    case 'PART_NO_MATCH':
    case 'CROSS_REFERENCE_MATCH':
    default:
      return 'CROSS_REFERENCE'
  }
}

function confidenceForOrigin(origin: string, codeKind: ProductCodeKind): number {
  if (origin === 'ptdrk.ref_no') {
    if (codeKind === 'OEM') return 0.92
    if (codeKind === 'EAN') return 0.9
    return 0.82
  }
  if (origin.startsWith('dnmk.barcode')) return codeKind === 'EAN' ? 0.9 : 0.84
  if (origin === 'dnmk.part_no' || origin === 'bsbg.oem_no') return 0.92
  if (origin === 'bsbg.part_no') return 0.86
  return 0.78
}

function classifySupplierCode(rawCode: string, origin: string): ProductCodeKind {
  const normalized = normalizeCode(rawCode)
  if (!normalized) return 'CROSS_REFERENCE'
  if (/^\d{8,14}$/.test(normalized)) return 'EAN'
  if (origin.endsWith('part_no') || origin.endsWith('oem_no')) return 'OEM'
  if (/^[A-Z]{2,}\d{3,}[A-Z0-9]*$/.test(normalized)) return 'OEM'
  return 'CROSS_REFERENCE'
}

function pushSignal(
  out: ProductCodeSignalInput[],
  input: {
    sourceType: ProductCodeSourceType
    sourceRecordId: string
    rawCode: string | null | undefined
    origin: string
    codeKind?: ProductCodeKind
    evidence: Record<string, unknown>
  }
) {
  const rawCode = input.rawCode?.trim()
  if (!rawCode) return
  const normalizedCode = normalizeCode(rawCode)
  if (normalizedCode.length < 2) return
  const codeKind = input.codeKind ?? classifySupplierCode(rawCode, input.origin)

  out.push({
    sourceType: input.sourceType,
    sourceRecordId: input.sourceRecordId,
    rawCode,
    normalizedCode,
    codeKind,
    origin: input.origin,
    confidence: confidenceForOrigin(input.origin, codeKind),
    evidence: input.evidence
  })
}

function dedupeSignals(signals: ProductCodeSignalInput[]): ProductCodeSignalInput[] {
  const seen = new Set<string>()
  const out: ProductCodeSignalInput[] = []

  for (const signal of signals) {
    const key = [
      signal.sourceType,
      signal.sourceRecordId,
      signal.normalizedCode,
      signal.origin
    ].join(':')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(signal)
  }

  return out
}

export function buildDpmatchCodeSignals(
  source: DpmatchCodeSignalSource
): ProductCodeSignalInput[] {
  const signals: ProductCodeSignalInput[] = []
  const dnmkId = source.dnmkProductId ? String(source.dnmkProductId) : null

  if (dnmkId) {
    const evidence = { productMappingId: source.matchId }
    pushSignal(signals, {
      sourceType: 'DNMK',
      sourceRecordId: dnmkId,
      rawCode: source.dinamikPartNo,
      origin: 'dnmk.part_no',
      evidence
    })
    pushSignal(signals, {
      sourceType: 'DNMK',
      sourceRecordId: dnmkId,
      rawCode: source.dinamikBarcode1,
      origin: 'dnmk.barcode_1',
      evidence
    })
    pushSignal(signals, {
      sourceType: 'DNMK',
      sourceRecordId: dnmkId,
      rawCode: source.dinamikBarcode2,
      origin: 'dnmk.barcode_2',
      evidence
    })
    pushSignal(signals, {
      sourceType: 'DNMK',
      sourceRecordId: dnmkId,
      rawCode: source.dinamikBarcode3,
      origin: 'dnmk.barcode_3',
      evidence
    })
    pushSignal(signals, {
      sourceType: 'DNMK',
      sourceRecordId: dnmkId,
      rawCode: source.dinamikStockCode,
      origin: 'dnmk.stock_code',
      evidence
    })
  }

  if (source.ptdrkProductId) {
    const ptdrkId = String(source.ptdrkProductId)
    const evidence = { productMappingId: source.matchId }
    for (const token of splitReferenceTokens(source.ptRefNo)) {
      const matchType = classifyRefToken(token)
      pushSignal(signals, {
        sourceType: 'PTDRK',
        sourceRecordId: ptdrkId,
        rawCode: token,
        origin: 'ptdrk.ref_no',
        codeKind: toCodeKind(matchType),
        evidence: {
          ...evidence,
          refNo: source.ptRefNo,
          matchType
        }
      })
    }
    pushSignal(signals, {
      sourceType: 'PTDRK',
      sourceRecordId: ptdrkId,
      rawCode: source.ptPartNo,
      origin: 'ptdrk.part_no',
      evidence
    })
    pushSignal(signals, {
      sourceType: 'PTDRK',
      sourceRecordId: ptdrkId,
      rawCode: source.ptSku,
      origin: 'ptdrk.sku',
      codeKind: 'SKU',
      evidence
    })
  }

  return dedupeSignals(signals)
}

export function buildBasbugCodeSignals(
  source: BasbugCodeSignalSource
): ProductCodeSignalInput[] {
  const sourceRecordId = String(source.bsbgProductId)
  const signals: ProductCodeSignalInput[] = []

  pushSignal(signals, {
    sourceType: 'BSBG',
    sourceRecordId,
    rawCode: source.oemNo,
    origin: 'bsbg.oem_no',
    evidence: {}
  })
  pushSignal(signals, {
    sourceType: 'BSBG',
    sourceRecordId,
    rawCode: source.partNo,
    origin: 'bsbg.part_no',
    evidence: {}
  })
  pushSignal(signals, {
    sourceType: 'BSBG',
    sourceRecordId,
    rawCode: source.malzemeNo,
    origin: 'bsbg.malzeme_no',
    evidence: {}
  })

  return dedupeSignals(signals)
}

type DpmatchHydrationRow = {
  match_id: number
  dnmk_products_id: bigint
  ptdrk_products_id: number | null
  stock_code: string | null
  stock_name: string | null
  dinamik_brand: string | null
  part_no: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  image_url: string | null
  ptdrk_title: string | null
  ptdrk_part_no: string | null
  ptdrk_ref_no: string | null
  ptdrk_sku: string | null
  ptdrk_brand: string | null
}

function resolveDisplayName(row: DpmatchHydrationRow): string {
  return (
    row.ptdrk_title?.trim() ||
    row.stock_name?.trim() ||
    row.stock_code?.trim() ||
    row.ptdrk_part_no?.trim() ||
    `Product ${row.match_id}`
  )
}

function resolveBrandName(row: DpmatchHydrationRow): string | null {
  return row.dinamik_brand?.trim() || row.ptdrk_brand?.trim() || null
}

export async function ensureV0ProductFromProductMapping(
  productMappingId: number
): Promise<bigint | null> {
  const rows = await db.$queryRaw<DpmatchHydrationRow[]>(Prisma.sql`
    SELECT
      m.id AS match_id,
      m.dnmk_products_id,
      m.ptdrk_products_id,
      d.stock_code,
      d.stock_name,
      db.brand AS dinamik_brand,
      d.part_no,
      d.barcode_1,
      d.barcode_2,
      d.barcode_3,
      d.image_url,
      p.title AS ptdrk_title,
      p.part_no AS ptdrk_part_no,
      p.ref_no AS ptdrk_ref_no,
      p.sku AS ptdrk_sku,
      pb.name AS ptdrk_brand
    FROM v0.product_mapping m
    JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
    LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
    LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
    LEFT JOIN v0.ptdrk_brands pb ON pb.id = p.ptdrk_brands_id
    WHERE m.id = ${productMappingId}
      AND m.mapping_status = 'APPROVED'
      AND d.is_passive IS DISTINCT FROM TRUE
    LIMIT 1
  `)

  const row = rows[0]
  if (!row) return null

  const existing = await db.$queryRaw<Array<{ v0_product_id: bigint }>>(Prisma.sql`
    SELECT v0_product_id
    FROM v0.product_sources
    WHERE source_type = 'DNMK'
      AND source_record_id = ${row.dnmk_products_id.toString()}
    LIMIT 1
  `)

  let v0ProductId = existing[0]?.v0_product_id ?? null

  if (!v0ProductId) {
    const inserted = await db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      INSERT INTO v0.products (
        display_name,
        normalized_name,
        brand_name,
        primary_image_url
      )
      VALUES (
        ${resolveDisplayName(row)},
        ${normalizeCode(resolveDisplayName(row)) || null},
        ${resolveBrandName(row)},
        ${row.image_url}
      )
      RETURNING id
    `)
    v0ProductId = inserted[0]?.id ?? null
  }

  if (!v0ProductId) return null

  const sourceRows = await db.$queryRaw<Array<{ id: bigint; source_type: string }>>(Prisma.sql`
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
    VALUES (
      ${v0ProductId},
      'DNMK',
      ${row.dnmk_products_id.toString()},
      ${row.dnmk_products_id},
      ${row.match_id},
      ${row.stock_code},
      ${row.dinamik_brand},
      ${row.stock_name},
      TRUE
    )
    ON CONFLICT (source_type, source_record_id) DO UPDATE SET
      v0_product_id = EXCLUDED.v0_product_id,
      product_mapping_id = EXCLUDED.product_mapping_id,
      source_sku = EXCLUDED.source_sku,
      source_brand = EXCLUDED.source_brand,
      source_name = EXCLUDED.source_name,
      updated_at = NOW()
    RETURNING id, source_type
  `)

  if (row.ptdrk_products_id) {
    const ptRows = await db.$queryRaw<Array<{ id: bigint; source_type: string }>>(Prisma.sql`
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
      VALUES (
        ${v0ProductId},
        'PTDRK',
        ${String(row.ptdrk_products_id)},
        ${row.ptdrk_products_id},
        ${row.match_id},
        ${row.ptdrk_sku},
        ${row.ptdrk_brand},
        ${row.ptdrk_title},
        FALSE
      )
      ON CONFLICT (source_type, source_record_id) DO UPDATE SET
        v0_product_id = EXCLUDED.v0_product_id,
        product_mapping_id = EXCLUDED.product_mapping_id,
        source_sku = EXCLUDED.source_sku,
        source_brand = EXCLUDED.source_brand,
        source_name = EXCLUDED.source_name,
        updated_at = NOW()
      RETURNING id, source_type
    `)
    sourceRows.push(...ptRows)
  }

  const sourceIdByType = new Map(sourceRows.map((item) => [item.source_type, item.id]))
  const signals = buildDpmatchCodeSignals({
    matchId: row.match_id,
    dnmkProductId: row.dnmk_products_id,
    ptdrkProductId: row.ptdrk_products_id,
    dinamikPartNo: row.part_no,
    dinamikBarcode1: row.barcode_1,
    dinamikBarcode2: row.barcode_2,
    dinamikBarcode3: row.barcode_3,
    dinamikStockCode: row.stock_code,
    ptRefNo: row.ptdrk_ref_no,
    ptPartNo: row.ptdrk_part_no,
    ptSku: row.ptdrk_sku
  })

  await upsertProductCodeSignals(v0ProductId, sourceIdByType, signals)
  await upsertPublicPartLinkCandidates(v0ProductId, row.match_id)

  return v0ProductId
}

export async function upsertProductCodeSignals(
  v0ProductId: bigint,
  sourceIdByType: Map<string, bigint>,
  signals: ProductCodeSignalInput[]
): Promise<number> {
  let count = 0
  for (const signal of signals) {
    const sourceId = sourceIdByType.get(signal.sourceType) ?? null
    await db.$executeRaw(Prisma.sql`
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
      VALUES (
        ${v0ProductId},
        ${sourceId},
        ${signal.sourceType},
        ${signal.sourceRecordId},
        ${signal.rawCode},
        ${signal.normalizedCode},
        ${signal.codeKind},
        ${signal.origin},
        ${new Prisma.Decimal(signal.confidence)},
        ${JSON.stringify(signal.evidence)}::jsonb
      )
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
    `)
    count += 1
  }
  return count
}

export async function upsertPublicPartLinkCandidates(
  v0ProductId: bigint,
  productMappingId?: number | null
): Promise<number> {
  const signals = await db.$queryRaw<
    Array<{
      normalized_code: string
      raw_code: string
      code_kind: string
      origin: string
      confidence: Prisma.Decimal
    }>
  >(Prisma.sql`
    SELECT normalized_code, raw_code, code_kind, origin, confidence
    FROM v0.product_code_signals
    WHERE v0_product_id = ${v0ProductId}
      AND code_kind IN ('OEM', 'EAN', 'CROSS_REFERENCE')
    ORDER BY confidence DESC, id ASC
  `)

  const candidateEvidence = new Map<
    string,
    {
      partId: bigint
      matchReasons: Set<string>
      confidence: number
      codes: Array<Record<string, unknown>>
    }
  >()

  for (const signal of signals) {
    const candidates = await findPublicPartCandidatesByCode({
      rawCode: signal.normalized_code,
      limit: 50
    })
    for (const candidate of candidates) {
      const key = candidate.partId.toString()
      const entry =
        candidateEvidence.get(key) ??
        {
          partId: candidate.partId,
          matchReasons: new Set<string>(),
          confidence: 0,
          codes: []
        }
      entry.matchReasons.add(candidate.matchType)
      entry.confidence = Math.max(
        entry.confidence,
        Math.min(candidate.confidence, Number(signal.confidence.toString()))
      )
      entry.codes.push({
        rawCode: signal.raw_code,
        normalizedCode: signal.normalized_code,
        origin: signal.origin,
        signalKind: signal.code_kind,
        matchedCode: candidate.matchedCode,
        matchType: candidate.matchType
      })
      candidateEvidence.set(key, entry)
    }
  }

  const approvedPartIds = Array.from(candidateEvidence.values()).filter((entry) => {
    const strongReasons = ['OEM_MATCH', 'EAN_MATCH']
    const hasStrongReason = Array.from(entry.matchReasons).some((reason) =>
      strongReasons.includes(reason)
    )
    return hasStrongReason && candidateEvidence.size === 1
  })

  let count = 0
  for (const entry of candidateEvidence.values()) {
    const matchReason = Array.from(entry.matchReasons).join('+')
    const isApproved = approvedPartIds.some((approved) => approved.partId === entry.partId)
    const status = isApproved ? 'APPROVED' : 'CANDIDATE'

    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.product_public_part_links (
        v0_product_id,
        part_id,
        product_mapping_id,
        status,
        match_reason,
        confidence,
        evidence_json,
        approved_at
      )
      VALUES (
        ${v0ProductId},
        ${entry.partId},
        ${productMappingId ?? null},
        ${status},
        ${matchReason},
        ${new Prisma.Decimal(entry.confidence || 0.5)},
        ${JSON.stringify({
          codes: entry.codes,
          candidateCount: candidateEvidence.size
        })}::jsonb,
        ${isApproved ? new Date() : null}
      )
      ON CONFLICT (v0_product_id, part_id) DO UPDATE SET
        product_mapping_id = EXCLUDED.product_mapping_id,
        status = CASE
          WHEN v0.product_public_part_links.status = 'APPROVED' THEN 'APPROVED'
          ELSE EXCLUDED.status
        END,
        match_reason = EXCLUDED.match_reason,
        confidence = GREATEST(v0.product_public_part_links.confidence, EXCLUDED.confidence),
        evidence_json = EXCLUDED.evidence_json,
        approved_at = COALESCE(v0.product_public_part_links.approved_at, EXCLUDED.approved_at),
        updated_at = NOW()
    `)
    count += 1
  }

  return count
}

export function normalizeV0ProductBrandName(value: string | null | undefined): string | null {
  return normalizeBrandName(value)
}
