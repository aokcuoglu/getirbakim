import type { Pool } from "pg";

/**
 * Single-row currency anomalies (#1030). A supplier row whose currency disagrees with the rest of its brand and whose
 * converted cost is far above the brand's median is almost always a wrong currency code on one row (Başbuğ sent one
 * KENTPAR row as EUR among 196 TRY rows: 1,390.71 "EUR" became a ~77k TL cost for a ~1.5k TL part). An open anomaly
 * keeps the row unpriced in commerce_catalog (db/commerce.sql, supplier_price_anomalies) until the supplier corrects
 * it or an admin marks it "Anomali değil". Thresholds were measured on Başbuğ's 319k priced rows (19 Nov 2026): the
 * naive "other currency and 10× the median" rule flagged 2,817 rows, almost all brands genuinely priced in two
 * currencies (BSG, FEBI); these narrow it to one. #1050 adds the reverse direction (currencyUnderpriced) and rows far
 * from the same product's other-supplier offers whose value fits them in another currency (offerOutlier). #1142 reopens
 * a dismissed anomaly when the supplier's value moves REOPEN_FACTOR times from the one the admin dismissed. #1153 re-checks
 * the rows whose value a Başbuğ price/stock run changed (refreshPriceAnomaliesAfterImports), not only after full lists.
 * #1172 re-checks the rows whose value the order-time MalzemeAra refresh wrote (refreshPriceAnomaliesAfterCheckout),
 * before the same order opens its transaction.
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
  /**
   * Another supplier's TRY offer for the same product within CORROBORATION of the cost confirms the price; a relabel
   * must land within CORROBORATION of the other offers (#1050).
   */
  CORROBORATION: 3,
  /** An underpriced row (#1050) must also be cheaper than this percentile of its brand's dominant-currency rows. */
  LOW_PERCENTILE: 0.01,
  /**
   * A cross-offer outlier's relabel currency must be one its brand really prices in: at least this many of the brand's
   * rows… (#1050; IOE-VW's 5 USD rows among 1,142 are not, FEBI's 1,781 EUR rows among 12,946 are)
   */
  MIN_RELABEL_ROWS: 20,
  /** …and at least this share of them. */
  MIN_RELABEL_SHARE: 0.05,
  /**
   * A dismissed anomaly reopens when the supplier value (nf, in the supplier's currency) is at least this many times
   * the value the admin dismissed, or at most 1/REOPEN_FACTOR of it, while the rule still flags the row (#1142). In the
   * supplier's own currency, so exchange-rate moves never reopen a decision. Measured on 118,662 Başbuğ single-step nf
   * changes (12–21 Nov 2026): 0.45% moved 1.5× either way; the 1st and 99th percentiles were 0.750× and 1.320×.
   */
  REOPEN_FACTOR: 1.5,
};
export type PriceAnomalyThresholds = typeof priceAnomalyThresholds;

/** WHERE fragment on `supplier_items`: rows with an open price anomaly (#1049). */
export const openPriceAnomalyFilter = "supplier_items.id IN (SELECT a.supplier_item_id FROM supplier_price_anomalies a WHERE a.status='open')";

/** Every open anomaly's count (#1049), one `count` row: openPriceAnomalyCount without a scope, and /api/health/suppliers. */
export const openPriceAnomaliesSql = "SELECT count(*)::int AS count FROM supplier_price_anomalies WHERE status='open'";

/**
 * Open anomalies (#1049). Without a scope: all of them. With one: Başbuğ rows the admin list shows by default (company,
 * MRK depot, present in the list, optional group), so the card figure equals the filtered list total.
 */
export async function openPriceAnomalyCount(pool: Pick<Pool, "query">, scope?: { company: string; group?: string }) {
  const result = scope
    ? await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM supplier_price_anomalies a JOIN supplier_items i ON i.id=a.supplier_item_id
       WHERE a.status='open' AND i.supplier='basbug' AND i.company=$1 AND i.warehouse='MRK' AND i.presence='present' AND ($2='' OR i.list_group=$2)`,
      [scope.company, scope.group ?? ""])
    : await pool.query<{ count: number }>(openPriceAnomaliesSql);
  return result.rows[0].count;
}

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
  /** The LOW_PERCENTILE TL cost of the brand's rows in its dominant currency (#1050). */
  lowTry: number;
  /** The lowest TRY cost another supplier offers for the same product, if any (#1050). */
  otherOfferMinTry: number | null;
};
export type CurrencyVerdict = {
  anomaly: boolean;
  reason: "few-brand-rows" | "mixed-brand" | "below-ratio" | "not-relabel" | "corroborated" | null;
};

/** The brand guards both currency rules share: enough brand rows and a rare currency. `null` when both hold. */
function rareCurrency({ brandRows, currencyRows }: CurrencyCandidate, thresholds: PriceAnomalyThresholds): CurrencyVerdict | null {
  if (brandRows < thresholds.MIN_BRAND_ROWS) return { anomaly: false, reason: "few-brand-rows" };
  if (currencyRows > thresholds.MAX_CURRENCY_ROWS || currencyRows > brandRows * thresholds.MAX_CURRENCY_SHARE)
    return { anomaly: false, reason: "mixed-brand" };
  return null;
}

/** The rule, in order: enough brand rows, a rare currency, a large jump, a normal value when relabelled, no corroboration. */
export function currencyAnomaly(candidate: CurrencyCandidate, thresholds: PriceAnomalyThresholds = priceAnomalyThresholds): CurrencyVerdict {
  const { costTry, medianTry, relabelledTry, otherOfferTry } = candidate;
  const guard = rareCurrency(candidate, thresholds);
  if (guard) return guard;
  if (!(medianTry > 0) || costTry < thresholds.RATIO * medianTry) return { anomaly: false, reason: "below-ratio" };
  if (relabelledTry >= thresholds.RATIO * medianTry) return { anomaly: false, reason: "not-relabel" };
  if (otherOfferTry !== null && otherOfferTry >= costTry / thresholds.CORROBORATION) return { anomaly: false, reason: "corroborated" };
  return { anomaly: true, reason: null };
}

/**
 * The reverse direction (#1050): a rare-currency row far below its brand (Başbuğ's GLASER G 10118910 at 13.37 TL among
 * EUR rows with a 1,061 TL median: an EUR value labelled TL). In order: the same brand guards, at most 1/RATIO of the
 * median and below the brand's LOW_PERCENTILE row, a normal value when read in the dominant currency, and no other
 * supplier offering the product within CORROBORATION of the cost.
 */
export function currencyUnderpriced(candidate: CurrencyCandidate, thresholds: PriceAnomalyThresholds = priceAnomalyThresholds): CurrencyVerdict {
  const { costTry, medianTry, lowTry, relabelledTry, otherOfferMinTry } = candidate;
  const guard = rareCurrency(candidate, thresholds);
  if (guard) return guard;
  if (!(medianTry > 0) || costTry * thresholds.RATIO > medianTry || costTry >= lowTry) return { anomaly: false, reason: "below-ratio" };
  if (relabelledTry * thresholds.RATIO <= medianTry || relabelledTry >= thresholds.RATIO * medianTry) return { anomaly: false, reason: "not-relabel" };
  if (otherOfferMinTry !== null && otherOfferMinTry <= costTry * thresholds.CORROBORATION) return { anomaly: false, reason: "corroborated" };
  return { anomaly: true, reason: null };
}

export type OfferCandidate = {
  /** The row's cost converted with its own currency's rate (TL). */
  costTry: number;
  /** The lowest and highest TRY cost other suppliers offer for the same master product. */
  otherMinTry: number;
  otherMaxTry: number;
  /** The brand's priced rows in the supplier's sale scope (all currencies). */
  brandRows: number;
  /** The row's value read in each of the brand's other currencies (TL), with the brand's row count in that currency. */
  relabels: { currency: string; costTry: number; rows: number }[];
};
export type OfferVerdict = {
  anomaly: boolean;
  direction: "high" | "low" | null;
  relabelCurrency: string | null;
  reason: "within-ratio" | "not-relabel" | null;
};

/** The brand prices enough of its rows in the currency for a wrong label to be plausible. */
const brandUses = (rows: number, brandRows: number, thresholds: PriceAnomalyThresholds) =>
  rows >= thresholds.MIN_RELABEL_ROWS && rows >= brandRows * thresholds.MIN_RELABEL_SHARE;

/**
 * Cross-offer outliers (#1050): the row is RATIO times above every other supplier's offer for the same product, or
 * RATIO times below all of them, and read in another currency its brand really prices in (MIN_RELABEL_ROWS,
 * MIN_RELABEL_SHARE) it lands within CORROBORATION of them (Başbuğ's FEBI row at 28.64 TL where Dinamik sells the part
 * for 1,684 TL; FEBI has 1,781 EUR rows and read as EUR it fits). An outlier no such relabel explains may be a wrong
 * product link, a genuinely different part or the other supplier's error (IOE-VW, all EUR, 21× a Dinamik TL offer):
 * it is left alone.
 */
export function offerOutlier(candidate: OfferCandidate, thresholds: PriceAnomalyThresholds = priceAnomalyThresholds): OfferVerdict {
  const { costTry, otherMinTry, otherMaxTry, brandRows, relabels } = candidate;
  const direction = costTry >= thresholds.RATIO * otherMaxTry ? "high" : costTry * thresholds.RATIO <= otherMinTry ? "low" : null;
  if (!direction || !(otherMinTry > 0)) return { anomaly: false, direction: null, relabelCurrency: null, reason: "within-ratio" };
  const centre = Math.sqrt(otherMinTry * otherMaxTry);
  const fitting = relabels
    .filter(relabel => brandUses(relabel.rows, brandRows, thresholds))
    .filter(relabel => relabel.costTry * thresholds.CORROBORATION >= otherMinTry && relabel.costTry <= otherMaxTry * thresholds.CORROBORATION)
    .sort((a, b) => Math.abs(Math.log(a.costTry / centre)) - Math.abs(Math.log(b.costTry / centre)));
  if (!fitting.length) return { anomaly: false, direction, relabelCurrency: null, reason: "not-relabel" };
  return { anomaly: true, direction, relabelCurrency: fitting[0].currency, reason: null };
}

type CandidateRow = {
  id: string; code: string; brand: string; currency: string; dominant: string;
  brand_rows: number; currency_rows: number; nf: number; rate: number | null; dominant_rate: number | null;
  median_nf: number | null; low_nf: number | null; other_nf: number | null; other_min_nf: number | null;
};

type OfferRow = {
  id: string; code: string; brand: string; currency: string; brand_rows: number; currency_rows: number;
  nf: number; rate: number | null; other_min_nf: number; other_max_nf: number; other_offers: number;
  relabels: { currency: string; rate: number; rows: number }[] | null;
};

// Rows in the saleable scope (commerce_supplier_items) with a positive numeric cost; a brand is grouped per company
// across list groups. Rates are the latest successful import's selling rates (supplier_latest_imports, db/schema.sql),
// as commerce_catalog's latest/rates.
const itemRowsCte = `WITH latest AS (
  SELECT company,currencies_data FROM supplier_latest_imports WHERE supplier=$1
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
)`;

// Only rows in a rare non-dominant currency (≤ MAX_CURRENCY_ROWS) leave the scan; the decision is currencyAnomaly or
// currencyUnderpriced.
const candidatesSql = `${itemRowsCte}, brands AS (
  SELECT DISTINCT ON (company,brand) company,brand,currency AS dominant,sum(n) OVER (PARTITION BY company,brand) AS brand_rows
  FROM currencies ORDER BY company,brand,n DESC,currency
), candidates AS (
  SELECT w.*,b.dominant,b.brand_rows,c.n AS currency_rows
  FROM item_rows w JOIN brands b ON b.company=w.company AND b.brand=w.brand
  JOIN currencies c ON c.company=w.company AND c.brand=w.brand AND c.currency=w.currency
  WHERE w.currency<>b.dominant AND c.n<=$2 AND ($4::uuid[] IS NULL OR w.id=ANY($4))
), medians AS (
  SELECT d.company,d.brand,percentile_cont(0.5) WITHIN GROUP (ORDER BY d.nf) AS median_nf,
    percentile_cont($3::float8) WITHIN GROUP (ORDER BY d.nf) AS low_nf
  FROM item_rows d JOIN brands b ON b.company=d.company AND b.brand=d.brand AND d.currency=b.dominant
  WHERE EXISTS(SELECT 1 FROM candidates c WHERE c.company=d.company AND c.brand=d.brand)
  GROUP BY d.company,d.brand
)
SELECT c.id::text AS id,c.code,c.brand,c.currency,c.dominant,c.brand_rows::int AS brand_rows,c.currency_rows::int AS currency_rows,
  c.nf::float8 AS nf,CASE WHEN c.currency='TRY' THEN 1 ELSE r.rate END::float8 AS rate,
  CASE WHEN c.dominant='TRY' THEN 1 ELSE dr.rate END::float8 AS dominant_rate,m.median_nf::float8 AS median_nf,m.low_nf::float8 AS low_nf,
  other.nf::float8 AS other_nf,other.min_nf::float8 AS other_min_nf
FROM candidates c
LEFT JOIN rates r ON r.company=c.company AND r.currency=c.currency
LEFT JOIN rates dr ON dr.company=c.company AND dr.currency=c.dominant
LEFT JOIN medians m ON m.company=c.company AND m.brand=c.brand
-- Another supplier's TRY offer for the same master product (product_sources), whatever its stock.
LEFT JOIN LATERAL (
  SELECT max(o.nf) AS nf,min(o.nf) AS min_nf FROM (
    SELECT CASE WHEN jsonb_typeof(o.price_data->'nf')='number' THEN (o.price_data->>'nf')::numeric END AS nf
    FROM product_sources ps JOIN product_sources so ON so.product_id=ps.product_id
    JOIN supplier_items o ON o.id=so.supplier_item_id
    WHERE ps.supplier_item_id=c.id AND o.supplier<>$1 AND o.presence='present' AND o.product_data->>'dc' IN ('TL','TRY')) o
  WHERE o.nf>0
) other ON true
ORDER BY c.id`;

// Cross-offer outliers (#1050): every saleable row linked to a master product (product_sources) that other suppliers
// offer in TRY, aggregated set-based (one join, one GROUP BY); only rows RATIO times away from all those offers, or
// rows without a rate, leave the scan. `relabels`: the brand's row currencies with their rates (TRY = 1) and row counts,
// once per brand. The decision is offerOutlier.
const offerCandidatesSql = `${itemRowsCte}, offers AS (
  SELECT w.id,min(o.nf) AS min_nf,max(o.nf) AS max_nf,count(*) AS n FROM item_rows w
  JOIN product_sources ps ON ps.supplier_item_id=w.id
  -- The row's own link is most of the join and never another supplier's offer: skip it before the item lookup.
  JOIN product_sources so ON so.product_id=ps.product_id AND so.supplier_item_id<>ps.supplier_item_id
  JOIN (SELECT i.id,CASE WHEN jsonb_typeof(i.price_data->'nf')='number' THEN (i.price_data->>'nf')::numeric END AS nf
    FROM supplier_items i WHERE i.supplier<>$1 AND i.presence='present' AND i.product_data->>'dc' IN ('TL','TRY')) o ON o.id=so.supplier_item_id
  WHERE o.nf>0 AND ($3::uuid[] IS NULL OR w.id=ANY($3))
  GROUP BY w.id
), relabels AS (
  SELECT c.company,c.brand,jsonb_agg(jsonb_build_object('currency',c.currency,'rate',CASE WHEN c.currency='TRY' THEN 1 ELSE r.rate END::float8,
    'rows',c.n) ORDER BY c.currency) FILTER (WHERE c.currency='TRY' OR r.rate IS NOT NULL) AS relabels
  FROM currencies c LEFT JOIN rates r ON r.company=c.company AND r.currency=c.currency
  GROUP BY c.company,c.brand
), priced AS (
  SELECT w.*,CASE WHEN w.currency='TRY' THEN 1 ELSE r.rate END AS rate,f.min_nf,f.max_nf,f.n
  FROM item_rows w JOIN offers f ON f.id=w.id LEFT JOIN rates r ON r.company=w.company AND r.currency=w.currency
)
SELECT p.id::text AS id,p.code,p.brand,p.currency,b.brand_rows::int AS brand_rows,c.n::int AS currency_rows,
  p.nf::float8 AS nf,p.rate::float8 AS rate,p.min_nf::float8 AS other_min_nf,p.max_nf::float8 AS other_max_nf,p.n::int AS other_offers,
  l.relabels
FROM priced p
JOIN currencies c ON c.company=p.company AND c.brand=p.brand AND c.currency=p.currency
JOIN (SELECT company,brand,sum(n) AS brand_rows FROM currencies GROUP BY company,brand) b ON b.company=p.company AND b.brand=p.brand
LEFT JOIN relabels l ON l.company=p.company AND l.brand=p.brand
WHERE p.rate IS NULL OR p.nf*p.rate>=$2*p.max_nf OR p.nf*p.rate*$2<=p.min_nf
ORDER BY p.id`;

export type PriceAnomalyKind = "currency" | "offer-outlier";

export type PriceAnomalyEvidence = {
  code: string; brand: string; currency: string; dominant_currency: string; brand_rows: number; currency_rows: number;
  nf: number; exchange_rate: number; cost_kurus: number; median_kurus: number;
  /** Cost over the compared value: the brand median (currency) or the nearest other offer (offer-outlier); <1 when low. */
  ratio: number; other_offer_kurus: number | null;
  /** #1050; absent on older rows = "high". */
  direction?: "high" | "low";
  /** offer-outlier: the currency whose reading fits the other offers (also in dominant_currency). */
  relabel_currency?: string;
  other_offer_min_kurus?: number | null;
  other_offers?: number;
  /** #1142: the value and currency the admin dismissed (frozen; nf above is overwritten by every refresh). */
  dismissed_nf?: number;
  dismissed_currency?: string;
  /** #1142: an open row reopened because the value moved from this dismissed one. */
  reopened_from?: { nf: number; currency: string };
};

const kurus = (value: number) => Math.round(value * 100);
const ratioOf = (value: number, base: number) => value >= base ? Math.round(value / base * 10) / 10 : Number((value / base).toPrecision(3));

/**
 * The supplier's anomalies as of now, with their kind and evidence; read-only. A row both rules flag is stored once,
 * by precedence currency (high, then low) over offer-outlier. `ratesMissing`: a currency candidate's currency (or its
 * brand's) has no rate in the latest import, so this run cannot judge it. `unrated`: ids of offer-linked rows skipped
 * for want of a rate (they are unpriced in the catalog anyway). `itemIds` (#1153): judge only these rows; brand
 * medians, row counts and relabel currencies still come from the whole saleable scope.
 */
export async function detectPriceAnomalies(connection: Pick<Pool, "query">, supplier: PriceAnomalySupplier, thresholds = priceAnomalyThresholds,
  itemIds?: string[]) {
  const candidates = (await connection.query<CandidateRow>(candidatesSql,
    [supplier, thresholds.MAX_CURRENCY_ROWS, thresholds.LOW_PERCENTILE, itemIds ?? null])).rows;
  const offers = (await connection.query<OfferRow>(offerCandidatesSql, [supplier, thresholds.RATIO, itemIds ?? null])).rows;
  const flagged = new Map<string, { id: string; kind: PriceAnomalyKind; evidence: PriceAnomalyEvidence }>();
  let ratesMissing = false;
  const unrated: string[] = [];
  for (const row of candidates) {
    // No rate for either currency: the catalog cannot price the row anyway, and there is no TL value to compare.
    if (row.rate === null || row.dominant_rate === null) { ratesMissing = true; continue; }
    if (row.median_nf === null || row.low_nf === null) continue;
    const costTry = row.nf * row.rate, medianTry = row.median_nf * row.dominant_rate;
    const otherOfferTry = row.other_nf !== null && row.other_nf > 0 ? row.other_nf : null;
    const otherOfferMinTry = row.other_min_nf !== null && row.other_min_nf > 0 ? row.other_min_nf : null;
    const candidate: CurrencyCandidate = { brandRows: row.brand_rows, currencyRows: row.currency_rows, costTry, medianTry,
      relabelledTry: row.nf * row.dominant_rate, otherOfferTry, lowTry: row.low_nf * row.dominant_rate, otherOfferMinTry };
    const direction = currencyAnomaly(candidate, thresholds).anomaly ? "high" : currencyUnderpriced(candidate, thresholds).anomaly ? "low" : null;
    if (!direction) continue;
    flagged.set(row.id, { id: row.id, kind: "currency", evidence: {
      code: row.code, brand: row.brand, currency: row.currency, dominant_currency: row.dominant,
      brand_rows: row.brand_rows, currency_rows: row.currency_rows, nf: row.nf, exchange_rate: row.rate,
      cost_kurus: kurus(costTry), median_kurus: kurus(medianTry), ratio: ratioOf(costTry, medianTry),
      other_offer_kurus: otherOfferTry === null ? null : kurus(otherOfferTry),
      other_offer_min_kurus: otherOfferMinTry === null ? null : kurus(otherOfferMinTry), direction,
    } });
  }
  for (const row of offers) {
    // A linked row without a rate is unpriced in the catalog anyway: skipped and counted, the run still judges the rest.
    if (row.rate === null) { unrated.push(row.id); continue; }
    if (flagged.has(row.id)) continue;
    const costTry = row.nf * row.rate;
    const relabels = (row.relabels ?? []).filter(relabel => relabel.currency !== row.currency)
      .map(relabel => ({ currency: relabel.currency, costTry: row.nf * relabel.rate, rows: relabel.rows }));
    const verdict = offerOutlier({ costTry, otherMinTry: row.other_min_nf, otherMaxTry: row.other_max_nf, brandRows: row.brand_rows, relabels }, thresholds);
    if (!verdict.anomaly || !verdict.direction || !verdict.relabelCurrency) continue;
    const compared = verdict.direction === "high" ? row.other_max_nf : row.other_min_nf;
    flagged.set(row.id, { id: row.id, kind: "offer-outlier", evidence: {
      code: row.code, brand: row.brand, currency: row.currency, dominant_currency: verdict.relabelCurrency,
      brand_rows: row.brand_rows, currency_rows: row.currency_rows, nf: row.nf, exchange_rate: row.rate,
      cost_kurus: kurus(costTry), median_kurus: 0, ratio: ratioOf(costTry, compared),
      other_offer_kurus: kurus(row.other_max_nf), other_offer_min_kurus: kurus(row.other_min_nf), other_offers: row.other_offers,
      direction: verdict.direction, relabel_currency: verdict.relabelCurrency,
    } });
  }
  return { flagged: [...flagged.values()], ratesMissing, unrated };
}

/**
 * The admin's decision (#1030, #1142): "Anomali değil" (dismissed) freezes the current value and currency as the
 * baseline later refreshes compare with; "Yeniden işaretle" (open) clears it. decided_by/decided_at record who and when.
 * `expected`: the value and currency the admin saw; a decision on a stale page (a refresh changed the value or the
 * status since) updates nothing. Returns whether the row was updated.
 */
export async function setPriceAnomalyStatus(connection: Pick<Pool, "query">, id: string, status: "open" | "dismissed", accountId: string | null,
  expected?: { nf: number; currency: string }) {
  const updated = await connection.query(`UPDATE supplier_price_anomalies SET status=$2,decided_by=$3,decided_at=now(),
    evidence=CASE WHEN $2='dismissed'
      THEN (evidence - 'reopened_from') || jsonb_build_object('dismissed_nf',evidence->'nf','dismissed_currency',evidence->'currency')
      ELSE evidence - 'dismissed_nf' - 'dismissed_currency' - 'reopened_from' END
    WHERE supplier_item_id=$1 AND status<>$2
    AND ($4::jsonb IS NULL OR evidence->'nf'=$4::jsonb) AND ($5::text IS NULL OR evidence->>'currency'=$5)`,
  [id, status, accountId, expected ? JSON.stringify(expected.nf) : null, expected?.currency ?? null]);
  return (updated.rowCount ?? 0) > 0;
}

/** How long a refresh waits for another one holding the lock (#1153). */
const LOCK_TIMEOUT_MS = 5_000;
/**
 * How long the order-time re-check waits for the lock and then for each statement (#1172): it runs inside a customer's
 * order request, so it gives up sooner and the order continues; the next scheduler tick's scoped run re-checks the row
 * (refreshPriceAnomaliesAfterImports reads the checkout's changes too). A scoped detection takes ~0.45 s.
 */
const CHECKOUT_LOCK_TIMEOUT_MS = 2_000;
const CHECKOUT_STATEMENT_TIMEOUT_MS = 3_000;

// The latest successful import's rates per company, and whether an anomaly row `a` cannot be judged with them: its
// own currency or its relabel/dominant currency has no rate (an offer-outlier's relabel currency drops out of the scan
// without one, #1050). Shared by the DELETE guard and the unjudged reopen (#1153); $1 is the supplier.
const judgedRatesCte = `WITH latest AS (
  SELECT company,currencies_data FROM supplier_latest_imports WHERE supplier=$1
), rates AS (
  SELECT company,r->>'dovizCinsi' AS currency FROM latest CROSS JOIN LATERAL jsonb_array_elements(currencies_data->'dovizListesi') r
  WHERE r->>'satis' IS NOT NULL
)`;
const unjudgeableSql = `EXISTS(
  SELECT 1 FROM supplier_items i CROSS JOIN LATERAL (VALUES (a.evidence->>'currency'),(a.evidence->>'dominant_currency')) c(currency)
  WHERE i.id=a.supplier_item_id AND c.currency IS NOT NULL AND c.currency NOT IN ('TL','TRY')
  AND NOT EXISTS(SELECT 1 FROM rates r WHERE r.company=i.company AND r.currency=c.currency))`;

/**
 * Re-detects the supplier's anomalies and stores them (one transaction): new rows open, known rows keep their status
 * (a dismissed row stays dismissed) with fresh evidence. A dismissed row keeps its baseline (dismissed_nf,
 * dismissed_currency; a row dismissed before #1142 takes its previous nf as baseline on its first flagged run) and is
 * reopened (`reopened`) when the rule still flags it and its value moved REOPEN_FACTOR times either way from the
 * baseline or its currency changed; the reopened row carries `reopened_from` until it is decided again. A dismissed row
 * the run cannot judge for want of a rate (see below) is compared with its baseline on the supplier's current value and
 * currency and reopened the same way (#1153), so a material move does not stay priced until the rate returns. An open
 * row no longer detected is deleted, which prices it again. A dismissed row is the admin's decision: it is deleted only
 * when its item is gone or the supplier changed the row's currency, not when a run merely misses it (a corroborating
 * offer or the brand's row count came and went). A run with a missing rate for a currency candidate deletes nothing;
 * otherwise a row the run could not judge (no rate for its own or its relabel currency, or skipped as unrated) is kept.
 * `itemIds` (#1153): judge, reopen and delete only these rows; others keep their state until a full refresh. Another
 * refresh running: waits up to `lockTimeoutMs` for it (a refresh takes under 2 s, and skipping would drop a scoped
 * run's rows or a panel's full refresh), then `{ skipped: true }`. The order-time re-check (#1172) scopes it to the rows
 * the order's MalzemeAra refresh repriced and waits less (refreshPriceAnomaliesAfterCheckout). `statementTimeoutMs`
 * bounds each statement after the lock is taken (unset: the server default); a timeout rolls back and throws.
 */
export async function refreshPriceAnomalies(pool: Pool, supplier: PriceAnomalySupplier, itemIds?: string[],
  { lockTimeoutMs = LOCK_TIMEOUT_MS, statementTimeoutMs }: { lockTimeoutMs?: number; statementTimeoutMs?: number } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('lock_timeout',$1,true)", [`${lockTimeoutMs}ms`]);
    try { await client.query("SELECT pg_advisory_xact_lock(20261001,11)"); }
    catch (error) {
      if ((error as { code?: string }).code !== "55P03") throw error;
      await client.query("ROLLBACK");
      return { skipped: true as const };
    }
    await client.query("SET LOCAL lock_timeout TO DEFAULT");
    if (statementTimeoutMs !== undefined) await client.query("SELECT set_config('statement_timeout',$1,true)", [`${statementTimeoutMs}ms`]);
    const { flagged, ratesMissing, unrated } = await detectPriceAnomalies(client, supplier, priceAnomalyThresholds, itemIds);
    const flaggedIds = flagged.map(row => row.id);
    // Kept regardless of this run: detected again, or skipped for want of a rate.
    const kept = [...flaggedIds, ...unrated];
    // Fresh evidence keeps the decision's baseline (#1142): a dismissed row's dismissed_nf/currency (or, before #1142,
    // its previous nf/currency), an open reopened row's reopened_from.
    await client.query(`INSERT INTO supplier_price_anomalies AS a(supplier_item_id,supplier,kind,evidence)
      SELECT x.id,$1,x.kind,x.evidence FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,kind text,evidence jsonb)
      ON CONFLICT (supplier_item_id) DO UPDATE SET kind=EXCLUDED.kind,last_seen_at=now(),
        evidence=EXCLUDED.evidence || CASE
          WHEN a.status='dismissed' THEN jsonb_strip_nulls(jsonb_build_object(
            'dismissed_nf',COALESCE(a.evidence->'dismissed_nf',a.evidence->'nf'),
            'dismissed_currency',COALESCE(a.evidence->'dismissed_currency',a.evidence->'currency')))
          WHEN a.evidence ? 'reopened_from' THEN jsonb_build_object('reopened_from',a.evidence->'reopened_from')
          ELSE '{}'::jsonb END`,
      [supplier, JSON.stringify(flagged)]);
    // A dismissed row the rule still flags reopens when its value moved materially or its currency changed (#1142).
    // decided_by/decided_at stay as the audit of the earlier decision.
    const reopenedFlagged = (await client.query(`UPDATE supplier_price_anomalies SET status='open',detected_at=now(),
        evidence=(evidence - 'dismissed_nf' - 'dismissed_currency')
          || jsonb_build_object('reopened_from',jsonb_build_object('nf',evidence->'dismissed_nf','currency',evidence->'dismissed_currency'))
      WHERE supplier=$1 AND status='dismissed' AND supplier_item_id=ANY($2::uuid[])
      AND (evidence->>'dismissed_currency' IS DISTINCT FROM evidence->>'currency'
        OR (jsonb_typeof(evidence->'dismissed_nf')='number' AND (evidence->>'dismissed_nf')::numeric>0
          AND ((evidence->>'nf')::numeric>=(evidence->>'dismissed_nf')::numeric*$3::numeric
            OR (evidence->>'nf')::numeric*$3::numeric<=(evidence->>'dismissed_nf')::numeric)))`,
      [supplier, flaggedIds, priceAnomalyThresholds.REOPEN_FACTOR])).rowCount ?? 0;
    // A dismissed row the run could not judge (#1153): the same comparison against the supplier's current value and
    // currency (as itemRowsCte reads them), since its evidence is not refreshed. The baseline falls back to the last
    // stored nf/currency for a row dismissed before #1142.
    const reopenedUnjudged = (await client.query(`${judgedRatesCte}
      UPDATE supplier_price_anomalies a SET status='open',detected_at=now(),
        evidence=(a.evidence - 'dismissed_nf' - 'dismissed_currency') || jsonb_build_object('nf',cur.nf,'currency',cur.currency,
          'reopened_from',jsonb_build_object('nf',COALESCE(a.evidence->'dismissed_nf',a.evidence->'nf'),
            'currency',COALESCE(a.evidence->'dismissed_currency',a.evidence->'currency')))
      FROM (SELECT i.id,
          CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 'TRY' ELSE i.product_data->>'dc' END AS currency,
          CASE WHEN jsonb_typeof(i.price_data->'nf')='number' THEN (i.price_data->>'nf')::numeric END AS nf
        FROM supplier_items i WHERE i.supplier=$1) cur
      WHERE cur.id=a.supplier_item_id AND cur.nf>0 AND a.supplier=$1 AND a.status='dismissed' AND a.supplier_item_id<>ALL($2::uuid[])
      AND ($3::uuid[] IS NULL OR a.supplier_item_id=ANY($3)) AND ${unjudgeableSql}
      AND (COALESCE(a.evidence->>'dismissed_currency',a.evidence->>'currency') IS DISTINCT FROM cur.currency
        OR (jsonb_typeof(COALESCE(a.evidence->'dismissed_nf',a.evidence->'nf'))='number'
          AND COALESCE(a.evidence->>'dismissed_nf',a.evidence->>'nf')::numeric>0
          AND (cur.nf>=COALESCE(a.evidence->>'dismissed_nf',a.evidence->>'nf')::numeric*$4::numeric
            OR cur.nf*$4::numeric<=COALESCE(a.evidence->>'dismissed_nf',a.evidence->>'nf')::numeric)))`,
      [supplier, flaggedIds, itemIds ?? null, priceAnomalyThresholds.REOPEN_FACTOR])).rowCount ?? 0;
    // Never deletes a row the run could not judge (judgedRatesCte). A row reopened above with a new currency can become
    // judgeable and, now open and not flagged, be deleted in the same run: counted in both `reopened` and `removed`.
    const removed = ratesMissing ? 0 : (await client.query(`${judgedRatesCte}
      DELETE FROM supplier_price_anomalies a
      WHERE a.supplier=$1 AND a.supplier_item_id<>ALL($2::uuid[]) AND ($3::uuid[] IS NULL OR a.supplier_item_id=ANY($3))
      AND (a.status='open' OR NOT EXISTS(
        SELECT 1 FROM supplier_items i WHERE i.id=a.supplier_item_id
        AND CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 'TRY' ELSE i.product_data->>'dc' END=a.evidence->>'currency'))
      AND NOT ${unjudgeableSql}`,
      [supplier, kept, itemIds ?? null])).rowCount ?? 0;
    const open = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM supplier_price_anomalies WHERE supplier=$1 AND status='open'",
      [supplier])).rows[0].n;
    await client.query("COMMIT");
    return { skipped: false as const, flagged: flagged.length, open, removed, reopened: reopenedFlagged + reopenedUnjudged, ratesMissing,
      unrated: unrated.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Above this many changed rows a scoped re-check saves little over the whole scope: refresh everything instead. */
const MAX_SCOPED_ROWS = 20_000;

/** Without an earlier succeeded import, checkout changes this far back are re-checked (a tick is 30 minutes). */
const CHECKOUT_FALLBACK_WINDOW = "40 minutes";

/**
 * After Başbuğ price/stock runs (#1153): re-checks only the rows whose value (nf) these imports changed. A commerce run
 * never changes a row's currency, so a run without nf changes needs no detection (`{ changed: 0 }`). The changes are
 * the imports' supplier_item_changes rows (changed_at = the import's completed_at, supplier_item_changes_date_idx).
 * Also the order-time MalzemeAra writes (import_id NULL, source checkout, #1172) since the previous succeeded import of
 * the supplier started (CHECKOUT_FALLBACK_WINDOW without one, at most a day): their own re-check may have been skipped
 * or failed, and the next commerce run sees no nf change for them. Re-checking a row twice is harmless.
 */
export async function refreshPriceAnomaliesAfterImports(pool: Pool, supplier: PriceAnomalySupplier, importIds: string[],
  { maxScopedRows = MAX_SCOPED_ROWS, lockTimeoutMs }: { maxScopedRows?: number; lockTimeoutMs?: number } = {}) {
  if (!importIds.length) return { changed: 0 };
  const ids = (await pool.query<{ id: string }>(`SELECT c.item_id::text AS id FROM supplier_imports r
    JOIN supplier_item_changes c ON c.changed_at=r.completed_at AND c.import_id=r.id
    WHERE r.id=ANY($1::uuid[]) AND r.supplier=$2 AND c.before_data->'price'->'nf' IS DISTINCT FROM c.after_data->'price'->'nf'
    UNION
    SELECT c.item_id::text FROM supplier_item_changes c JOIN supplier_items i ON i.id=c.item_id AND i.supplier=$2
    WHERE c.changed_at>=GREATEST(now()-interval '1 day',COALESCE(
        (SELECT max(p.started_at) FROM supplier_imports p WHERE p.supplier=$2 AND p.status='succeeded' AND p.id<>ALL($1::uuid[])
          AND p.started_at<(SELECT min(n.started_at) FROM supplier_imports n WHERE n.id=ANY($1::uuid[]))),
        now()-$3::interval))
    AND c.import_id IS NULL AND c.after_data->>'source'='checkout'
    AND c.before_data->'price'->'nf' IS DISTINCT FROM c.after_data->'price'->'nf'`,
  [importIds, supplier, CHECKOUT_FALLBACK_WINDOW])).rows.map(row => row.id);
  if (!ids.length) return { changed: 0 };
  return { changed: ids.length, ...await refreshPriceAnomalies(pool, supplier, ids.length > maxScopedRows ? undefined : ids, { lockTimeoutMs }) };
}

/**
 * After the order-time MalzemeAra refresh wrote a different nf (#1172): re-checks only those rows, after the refresh
 * committed and before the order opens its transaction, so a reopened anomaly unprices the row (commerce_catalog) and
 * the same order refuses the line. Never throws: a skipped run (lock held longer than `lockTimeoutMs`) or a failure
 * (including a statement over CHECKOUT_STATEMENT_TIMEOUT_MS) is logged and the order continues; the next scheduler
 * tick's scoped run re-checks the row from its supplier_item_changes record (refreshPriceAnomaliesAfterImports).
 */
export async function refreshPriceAnomaliesAfterCheckout(pool: Pool, supplier: PriceAnomalySupplier, itemIds: string[],
  { lockTimeoutMs = CHECKOUT_LOCK_TIMEOUT_MS }: { lockTimeoutMs?: number } = {}) {
  if (!itemIds.length) return { changed: 0 };
  try {
    const result = await refreshPriceAnomalies(pool, supplier, itemIds, { lockTimeoutMs, statementTimeoutMs: CHECKOUT_STATEMENT_TIMEOUT_MS });
    if (result.skipped) console.error({ priceAnomalies: "skipped", source: "checkout", rows: itemIds.length });
    return { changed: itemIds.length, ...result };
  } catch (error) {
    console.error({ priceAnomalies: "failed", source: "checkout", code: (error as { code?: string }).code });
    return { changed: itemIds.length, failed: true as const };
  }
}

/** After a manual Başbuğ list refresh in the panel (#1030): a failure is logged and keeps the previous list. */
export async function refreshBasbugPriceAnomalies(pool: Pool) {
  try {
    const result = await refreshPriceAnomalies(pool, "basbug");
    if (result.skipped) console.error({ priceAnomalies: "skipped" });
    return result;
  } catch (error) { console.error({ priceAnomalies: "failed", code: (error as { code?: string }).code }); }
}
