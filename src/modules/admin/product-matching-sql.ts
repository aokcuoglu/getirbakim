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
