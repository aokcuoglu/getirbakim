// SQL fragments shared by the matching admin page, its actions and scripts/test-product-matching.ts.

/** The Dinamik product of a candidate is suggested to another Başbuğ product too; it can join only one, so pick by hand. */
export const sharedCandidateSql = "EXISTS (SELECT 1 FROM product_match_candidates o WHERE o.product_b=c.product_b AND o.product_a<>c.product_a)";

/**
 * Candidate reasons merged in bulk without a pattern check. "suffix" is not one of them (#524): an extra digit or
 * ending is mostly another part (FEBI 100261 vs 1002610…1002619).
 */
export const wholeBulkReasons = ["prefix", "leading_zero"] as const;
/**
 * Candidate reasons the bulk merge accepts. Suffix candidates join only when their ending is a reviewed 'same' row of
 * product_suffix_rules() (#535: Ford colour codes, MAYSAN MM/WM/PM…); known different-part endings are never
 * generated (#534) and the rest are decided by hand.
 */
export const bulkCandidateReasons = [...wholeBulkReasons, "suffix"] as const;
export type BulkCandidateReason = (typeof bulkCandidateReasons)[number];
export const isBulkReason = (reason: string): reason is BulkCandidateReason => (bulkCandidateReasons as readonly string[]).includes(reason);
/** Only some candidates of this reason are bulk-acceptable (reviewed patterns); the rest need a decision by hand. */
export const isPatternBulkReason = (reason: string) => isBulkReason(reason) && !(wholeBulkReasons as readonly string[]).includes(reason);

/** Expects aliases `a` and `b` (the products rows of c.product_a and c.product_b): the suffix ending is reviewed as safe. */
const safeSuffixSql = "product_suffix_verdict(a.brand,a.part_number,b.part_number)='same'";

/**
 * Expects aliases `c` (candidate) and `b` (the products row of c.product_b). True when the same Başbuğ product is
 * suggested another Dinamik product with a different part number, or already joined one by a "same" decision (accepting
 * a candidate deletes its row, so the decisions count too). Same-number variant copies are not counted.
 */
export const multiNumberCandidateSql = `(EXISTS (SELECT 1 FROM product_match_candidates o JOIN products ob ON ob.id=o.product_b
   WHERE o.product_a=c.product_a AND o.product_b<>c.product_b AND ob.part_number<>b.part_number)
  OR EXISTS (SELECT 1 FROM product_match_decisions d JOIN products db ON db.id=d.product_b
   WHERE d.product_a=c.product_a AND d.status='same' AND d.product_b<>c.product_b AND db.part_number<>b.part_number))`;

/** Candidates the bulk merge may accept; expects aliases `c`, `a` and `b` (multiNumberCandidateSql, safeSuffixSql). */
export const bulkAcceptableSql = `(c.reason IN (${wholeBulkReasons.map(reason => `'${reason}'`).join(",")}) OR c.reason='suffix' AND ${safeSuffixSql})
  AND c.name_conflict IS NOT TRUE
  AND NOT ${sharedCandidateSql} AND NOT ${multiNumberCandidateSql}`;

/**
 * "Elle kararlar" (product_sources x JOIN products p LEFT JOIN accounts a): a decision is a split when its product is a
 * variant above 0, otherwise a merge; `manualKindFilterSql` takes the kind as a boolean parameter (true = split, NULL = all).
 */
export const manualKindSql = "CASE WHEN p.variant>0 THEN 'split' ELSE 'merge' END";
export const manualKindFilterSql = (parameter: string) => `(${parameter}::boolean IS NULL OR (p.variant>0)=${parameter}::boolean)`;
/** Who decided: the account's name, else its e-mail; NULL for decisions recorded without an actor. */
export const manualDeciderSql = "COALESCE(NULLIF(a.name,''),a.email)";
/** Whether an offer row of the matched groups (`offers.id`, a supplier item) is linked to its product by hand. */
export const offerManualSql = "EXISTS (SELECT 1 FROM product_sources s WHERE s.supplier_item_id=offers.id AND s.method='manual')";
/** The groups (product_offers.primary_id) with at least one offer linked by hand; a group counts even if only its primary row is manual (as the row badge shows); read with the matched groups index. */
export const manualGroupsSql = "SELECT DISTINCT o.primary_id::text AS primary_id FROM product_sources s JOIN product_offers o ON o.item_id=s.supplier_item_id WHERE s.method='manual'";

/**
 * The latest exchange rate per supplier and currency (`supplier`, `currency`, `rate`) from the last succeeded import of
 * each supplier and company; the company is ignored (commerce_catalog keys rates by company too). Shared by
 * productCostTrySql and scripts/measure-suffix-signals.ts (#587, #899).
 */
export const latestSupplierRatesSql = `
    WITH latest AS (
     SELECT DISTINCT ON (supplier,company) supplier,company,currencies_data,completed_at
     FROM supplier_imports WHERE status='succeeded' ORDER BY supplier,company,completed_at DESC,id DESC
    ), rates AS (
     SELECT supplier,completed_at,r->>'dovizCinsi' AS currency,(r->>'satis')::numeric AS rate
     FROM latest CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(currencies_data->'dovizListesi')='array' THEN currencies_data->'dovizListesi' ELSE '[]'::jsonb END) r
    )
    SELECT DISTINCT ON (supplier,currency) supplier,currency,rate FROM rates ORDER BY supplier,currency,completed_at DESC`;

/**
 * `$1::uuid[]` product ids -> the lowest supplier cost in TRY per product (`product_id`, `cost_try`), the #587 price
 * signal. A blank/TL/TRY currency counts as 1, otherwise the supplier's latest rate; rows without a rate or with
 * `nf<=0` are skipped. This is the buying cost, not the store sale price.
 */
export const productCostTrySql = `
  WITH s AS (SELECT product_id,supplier_item_id FROM product_sources WHERE product_id=ANY($1::uuid[])),
  r AS (${latestSupplierRatesSql})
  SELECT s.product_id, min(v.nf*v.rate) AS cost_try
  FROM s JOIN supplier_items i ON i.id=s.supplier_item_id
  LEFT JOIN r ON r.supplier=i.supplier AND r.currency=i.product_data->>'dc'
  CROSS JOIN LATERAL (SELECT (i.price_data->>'nf')::numeric AS nf,
   CASE WHEN COALESCE(i.product_data->>'dc','') IN ('','TL','TRY') THEN 1 ELSE r.rate END AS rate) v
  WHERE v.nf>0 AND v.rate>0
  GROUP BY s.product_id`;
