// SQL fragments shared by the matching admin page, its actions and scripts/test-product-matching.ts.

/** The Dinamik product of a candidate is suggested to another Başbuğ product too; it can join only one, so pick by hand. */
export const sharedCandidateSql = "EXISTS (SELECT 1 FROM product_match_candidates o WHERE o.product_b=c.product_b AND o.product_a<>c.product_a)";
