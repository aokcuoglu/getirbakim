import type { Pool } from "pg";

/**
 * Single-row currency anomalies (#1030). A supplier row whose currency disagrees with the rest of its brand and whose
 * converted cost is far above the brand's median is almost always a wrong currency code on one row (Başbuğ sent one
 * KENTPAR row as EUR among 196 TRY rows: 1,390.71 "EUR" became a ~77k TL cost for a ~1.5k TL part). An open anomaly
 * keeps the row unpriced in commerce_catalog (db/commerce.sql, supplier_price_anomalies) until the supplier corrects
 * it or an admin marks it "Anomali değil". Thresholds were measured on Başbuğ's 319k priced rows (19 Nov 2026): the
 * naive "other currency and 10× the median" rule flagged 2,817 rows, almost all brands genuinely priced in two
 * currencies (BSG, FEBI); these narrow it to one.
 */
export const priceAnomalyThresholds = {
  /** A brand needs this many priced rows before its median means anything. */
  MIN_BRAND_ROWS: 20,
  /** The row's currency is used by at most this many of the brand's rows… */
  MAX_CURRENCY_ROWS: 3,
  /** …and at most this share of them; more means the brand is really priced in both currencies. */
  MAX_CURRENCY_SHARE: 0.02,
  /** The converted cost is at least this many times the brand's median. */
  RATIO: 10,
  /** Another supplier's TRY offer for the same product at or above cost / CORROBORATION confirms the price. */
  CORROBORATION: 3,
};
export type PriceAnomalyThresholds = typeof priceAnomalyThresholds;

/**
 * Only Başbuğ sends a currency per row; Dinamik and manual lists store a fixed TRY (dinamik-import.ts,
 * manual-import.ts) and SETA a literal TRY (seta-import.ts). The rule itself is supplier-agnostic.
 */
export const priceAnomalySuppliers = ["basbug"] as const;
export type PriceAnomalySupplier = (typeof priceAnomalySuppliers)[number];

export type CurrencyCandidate = {
  /** The brand's priced rows in the supplier's sale scope (all currencies). */
  brandRows: number;
  /** The brand's rows in this row's currency. */
  currencyRows: number;
  /** The row's cost converted with its own currency's rate (TL). */
  costTry: number;
  /** The median TL cost of the brand's rows in its dominant currency. */
  medianTry: number;
  /** The row's cost read in the brand's dominant currency (TL): the "only the label is wrong" reading. */
  relabelledTry: number;
  /** The highest TRY cost another supplier offers for the same product, if any. */
  otherOfferTry: number | null;
};
export type CurrencyVerdict = {
  anomaly: boolean;
  reason: "few-brand-rows" | "mixed-brand" | "below-ratio" | "not-relabel" | "corroborated" | null;
};

/** The rule, in order: enough brand rows, a rare currency, a large jump, a normal value when relabelled, no corroboration. */
export function currencyAnomaly(candidate: CurrencyCandidate, thresholds: PriceAnomalyThresholds = priceAnomalyThresholds): CurrencyVerdict {
  const { brandRows, currencyRows, costTry, medianTry, relabelledTry, otherOfferTry } = candidate;
  if (brandRows < thresholds.MIN_BRAND_ROWS) return { anomaly: false, reason: "few-brand-rows" };
  if (currencyRows > thresholds.MAX_CURRENCY_ROWS || currencyRows > brandRows * thresholds.MAX_CURRENCY_SHARE)
    return { anomaly: false, reason: "mixed-brand" };
  if (!(medianTry > 0) || costTry < thresholds.RATIO * medianTry) return { anomaly: false, reason: "below-ratio" };
  if (relabelledTry >= thresholds.RATIO * medianTry) return { anomaly: false, reason: "not-relabel" };
  if (otherOfferTry !== null && otherOfferTry >= costTry / thresholds.CORROBORATION) return { anomaly: false, reason: "corroborated" };
  return { anomaly: true, reason: null };
}

type CandidateRow = {
  id: string; code: string; brand: string; currency: string; dominant: string;
  brand_rows: number; currency_rows: number; nf: number; rate: number | null; dominant_rate: number | null;
  median_nf: number | null; other_nf: number | null;
};

// Rows in the saleable scope (commerce_supplier_items) with a positive numeric cost; a brand is grouped per company
// across list groups. Rates are the latest successful import's selling rates, as commerce_catalog's latest/rates.
// Only rows in a rare non-dominant currency (≤ MAX_CURRENCY_ROWS) leave the scan; the decision is currencyAnomaly.
const candidatesSql = `WITH latest AS (
  SELECT DISTINCT ON (company) company,currencies_data FROM supplier_imports
  WHERE supplier=$1 AND status='succeeded' ORDER BY company,completed_at DESC,id DESC
), rates AS (
  SELECT company,r->>'dovizCinsi' AS currency,(r->>'satis')::numeric AS rate
  FROM latest CROSS JOIN LATERAL jsonb_array_elements(currencies_data->'dovizListesi') r
), item_rows AS MATERIALIZED (
  SELECT id,company,code,brand,currency,nf FROM (
    SELECT i.id,i.company,i.code,supplier_item_brand(i.supplier,i.product_data) AS brand,
      CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 'TRY' ELSE i.product_data->>'dc' END AS currency,
      CASE WHEN jsonb_typeof(i.price_data->'nf')='number' THEN (i.price_data->>'nf')::numeric END AS nf
    FROM commerce_supplier_items i WHERE i.supplier=$1) priced
  WHERE nf>0 AND brand IS NOT NULL AND currency IS NOT NULL
), currencies AS (
  SELECT company,brand,currency,count(*) AS n FROM item_rows GROUP BY company,brand,currency
), brands AS (
  SELECT DISTINCT ON (company,brand) company,brand,currency AS dominant,sum(n) OVER (PARTITION BY company,brand) AS brand_rows
  FROM currencies ORDER BY company,brand,n DESC,currency
), candidates AS (
  SELECT w.*,b.dominant,b.brand_rows,c.n AS currency_rows
  FROM item_rows w JOIN brands b ON b.company=w.company AND b.brand=w.brand
  JOIN currencies c ON c.company=w.company AND c.brand=w.brand AND c.currency=w.currency
  WHERE w.currency<>b.dominant AND c.n<=$2
), medians AS (
  SELECT d.company,d.brand,percentile_cont(0.5) WITHIN GROUP (ORDER BY d.nf) AS median_nf
  FROM item_rows d JOIN brands b ON b.company=d.company AND b.brand=d.brand AND d.currency=b.dominant
  WHERE EXISTS(SELECT 1 FROM candidates c WHERE c.company=d.company AND c.brand=d.brand)
  GROUP BY d.company,d.brand
)
SELECT c.id::text AS id,c.code,c.brand,c.currency,c.dominant,c.brand_rows::int AS brand_rows,c.currency_rows::int AS currency_rows,
  c.nf::float8 AS nf,r.rate::float8 AS rate,
  CASE WHEN c.dominant='TRY' THEN 1 ELSE dr.rate END::float8 AS dominant_rate,m.median_nf::float8 AS median_nf,other.nf::float8 AS other_nf
FROM candidates c
LEFT JOIN rates r ON r.company=c.company AND r.currency=c.currency
LEFT JOIN rates dr ON dr.company=c.company AND dr.currency=c.dominant
LEFT JOIN medians m ON m.company=c.company AND m.brand=c.brand
-- Another supplier's TRY offer for the same master product (product_sources), whatever its stock.
LEFT JOIN LATERAL (
  SELECT max(CASE WHEN jsonb_typeof(o.price_data->'nf')='number' THEN (o.price_data->>'nf')::numeric END) AS nf
  FROM product_sources ps JOIN product_sources so ON so.product_id=ps.product_id
  JOIN supplier_items o ON o.id=so.supplier_item_id
  WHERE ps.supplier_item_id=c.id AND o.supplier<>$1 AND o.presence='present' AND o.product_data->>'dc' IN ('TL','TRY')
) other ON true
ORDER BY c.id`;

export type PriceAnomalyEvidence = {
  code: string; brand: string; currency: string; dominant_currency: string; brand_rows: number; currency_rows: number;
  nf: number; exchange_rate: number; cost_kurus: number; median_kurus: number; ratio: number; other_offer_kurus: number | null;
};

/** The supplier's anomalies as of now, with their evidence; read-only. */
export async function detectPriceAnomalies(connection: Pick<Pool, "query">, supplier: PriceAnomalySupplier, thresholds = priceAnomalyThresholds) {
  const rows = (await connection.query<CandidateRow>(candidatesSql, [supplier, thresholds.MAX_CURRENCY_ROWS])).rows;
  const flagged: { id: string; evidence: PriceAnomalyEvidence }[] = [];
  for (const row of rows) {
    // No rate for either currency: the catalog cannot price the row anyway, and there is no TL value to compare.
    if (row.rate === null || row.dominant_rate === null || row.median_nf === null) continue;
    const costTry = row.nf * row.rate, medianTry = row.median_nf * row.dominant_rate;
    const otherOfferTry = row.other_nf !== null && row.other_nf > 0 ? row.other_nf : null;
    const verdict = currencyAnomaly({ brandRows: row.brand_rows, currencyRows: row.currency_rows, costTry, medianTry,
      relabelledTry: row.nf * row.dominant_rate, otherOfferTry }, thresholds);
    if (!verdict.anomaly) continue;
    flagged.push({ id: row.id, evidence: {
      code: row.code, brand: row.brand, currency: row.currency, dominant_currency: row.dominant,
      brand_rows: row.brand_rows, currency_rows: row.currency_rows, nf: row.nf, exchange_rate: row.rate,
      cost_kurus: Math.round(costTry * 100), median_kurus: Math.round(medianTry * 100),
      ratio: Math.round(costTry / medianTry * 10) / 10,
      other_offer_kurus: otherOfferTry === null ? null : Math.round(otherOfferTry * 100),
    } });
  }
  return flagged;
}

/**
 * Re-detects the supplier's anomalies and stores them (one transaction): new rows open, known rows keep their status
 * (a dismissed row stays dismissed) with fresh evidence, and rows no longer detected (corrected by the supplier, or
 * their item gone) are deleted, which prices them again. Another refresh already running: `{ skipped: true }`.
 */
export async function refreshPriceAnomalies(pool: Pool, supplier: PriceAnomalySupplier) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(20261001,11) AS locked")).rows[0].locked) {
      await client.query("ROLLBACK");
      return { skipped: true as const };
    }
    const flagged = await detectPriceAnomalies(client, supplier);
    await client.query(`INSERT INTO supplier_price_anomalies(supplier_item_id,supplier,evidence)
      SELECT x.id,$1,x.evidence FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,evidence jsonb)
      ON CONFLICT (supplier_item_id) DO UPDATE SET evidence=EXCLUDED.evidence,last_seen_at=now()`,
      [supplier, JSON.stringify(flagged)]);
    const removed = (await client.query("DELETE FROM supplier_price_anomalies WHERE supplier=$1 AND supplier_item_id<>ALL($2::uuid[])",
      [supplier, flagged.map(row => row.id)])).rowCount ?? 0;
    const open = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM supplier_price_anomalies WHERE supplier=$1 AND status='open'",
      [supplier])).rows[0].n;
    await client.query("COMMIT");
    return { skipped: false as const, flagged: flagged.length, open, removed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** After a manual Başbuğ list refresh in the panel (#1030): a failure is logged and keeps the previous list. */
export async function refreshBasbugPriceAnomalies(pool: Pool) {
  try { return await refreshPriceAnomalies(pool, "basbug"); }
  catch (error) { console.error({ priceAnomalies: "failed", code: (error as { code?: string }).code }); }
}
