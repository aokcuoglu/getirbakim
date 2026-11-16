/**
 * SQL fragments for the brand the store shows on a supplier row (#811): the admin's override brand, else the master
 * brand name of the supplier's label (supplier_brands → brands), else the raw label, else "Belirtilmemiş". Same rule as
 * display_brand in db/commerce.sql and db/storefront-catalog.sql; change them together. The arguments are SQL aliases of
 * the caller's query, never user input. The joins use the aliases `sb` and `mb`.
 */

/** Joins the master brand of supplier row `item`; both are unique-key joins the planner drops when unused. */
export const masterBrandJoinSql = (item: string) =>
  `LEFT JOIN supplier_brands sb ON sb.supplier=${item}.supplier AND sb.label=supplier_item_brand(${item}.supplier,${item}.product_data)
   LEFT JOIN brands mb ON mb.id=sb.brand_id`;

/** The shown brand of supplier row `item` with its override row `override` (needs masterBrandJoinSql). */
export const displayBrandSql = (item: string, override: string) =>
  `COALESCE(${override}.brand,mb.name,NULLIF(${item}.product_data->>'uk',''),'Belirtilmemiş')`;
