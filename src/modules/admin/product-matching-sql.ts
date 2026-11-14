// SQL fragments shared by the matching admin page, its actions and scripts/test-product-matching.ts.

/** The Dinamik product of a candidate is suggested to another Başbuğ product too; it can join only one, so pick by hand. */
export const sharedCandidateSql = "EXISTS (SELECT 1 FROM product_match_candidates o WHERE o.product_b=c.product_b AND o.product_a<>c.product_a)";

/**
 * Candidate reasons that may be merged in bulk. "suffix" is left out (#524): an extra digit or ending is mostly another
 * part (FEBI 100261 vs 1002610…1002619), so every suffix pair is decided by hand.
 */
export const bulkCandidateReasons = ["prefix", "leading_zero"] as const;
export type BulkCandidateReason = (typeof bulkCandidateReasons)[number];
export const isBulkReason = (reason: string): reason is BulkCandidateReason => (bulkCandidateReasons as readonly string[]).includes(reason);

/**
 * Expects aliases `c` (candidate) and `b` (the products row of c.product_b). True when the same Başbuğ product is
 * suggested another Dinamik product with a different part number, or already joined one by a "same" decision (accepting
 * a candidate deletes its row, so the decisions count too). Same-number variant copies are not counted.
 */
export const multiNumberCandidateSql = `(EXISTS (SELECT 1 FROM product_match_candidates o JOIN products ob ON ob.id=o.product_b
   WHERE o.product_a=c.product_a AND o.product_b<>c.product_b AND ob.part_number<>b.part_number)
  OR EXISTS (SELECT 1 FROM product_match_decisions d JOIN products db ON db.id=d.product_b
   WHERE d.product_a=c.product_a AND d.status='same' AND d.product_b<>c.product_b AND db.part_number<>b.part_number))`;

/** Candidates the bulk merge may accept; expects aliases `c` and `b` like multiNumberCandidateSql. */
export const bulkAcceptableSql = `c.reason IN (${bulkCandidateReasons.map(reason => `'${reason}'`).join(",")}) AND c.name_conflict IS NOT TRUE
  AND NOT ${sharedCandidateSql} AND NOT ${multiNumberCandidateSql}`;
