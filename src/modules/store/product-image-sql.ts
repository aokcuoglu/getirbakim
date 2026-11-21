/**
 * SQL fragments for "does the store show an image for this product" (#596), shared by the home rails and the admin
 * "görsel yok" filters. A product shows an image when the admin uploaded one (product_override_images, #581) or when it
 * has an automatic (enrichment) image that the admin did not hide (product_override_image_settings.hide_automatic).
 * The arguments are SQL expressions of the caller's query (a column or a subquery), never user input.
 */

/** The product has at least one admin upload. */
export const uploadedImageSql = (product: string) =>
  `EXISTS (SELECT 1 FROM product_override_images u WHERE u.product_id=${product})`;

/** The admin hid the product's automatic image in the store. */
export const automaticImageHiddenSql = (product: string) =>
  `EXISTS (SELECT 1 FROM product_override_image_settings st WHERE st.product_id=${product} AND st.hide_automatic)`;

/** The master product of a supplier row (NULL while the row is not matched yet). */
export const itemProductSql = (item: string) =>
  `(SELECT ps.product_id FROM product_sources ps WHERE ps.supplier_item_id=${item})`;

/** The store shows an image: an upload, or the automatic image (`automatic`, a boolean expression) unless it is hidden. */
export const shownImageSql = (product: string, automatic: string) =>
  `(${uploadedImageSql(product)} OR (${automatic} AND NOT ${automaticImageHiddenSql(product)}))`;

/** Supplier rows whose product's automatic image is hidden. */
export const hiddenAutomaticItemsSql =
  "SELECT ps.supplier_item_id FROM product_override_image_settings st JOIN product_sources ps ON ps.product_id=st.product_id WHERE st.hide_automatic";

/** Media ids of automatic images an admin blocked (product_image_blocks, #1136); sha256 ties them across machines. */
export const blockedMediaSql = "SELECT m.id FROM product_image_blocks b JOIN product_media_objects m ON m.sha256=b.sha256";
