import { isIndexableListing, type CatalogQuery } from "@/modules/store/catalog-query";

/**
 * Which product pages search engines may index (#634, #641). Demo rows and unavailable cards (no supplier sells the
 * product now, #475) stay `noindex,follow`; store rows are indexed. A supplier catalog page is indexed only with
 * minimum content: besides its name, brand and part number, at least one distinguishing, verifiable fact.
 *
 * - `enrichment`: an enrichment matched to the supplier's code and brand (OEM / cross references, vehicles, specs).
 * - `descriptionFitment`: vehicle models read from the supplier's description of the product or its grouped offers (#392).
 * - `supplierOem`: the supplier's OEM number, unless an admin hid it (#582).
 * - `adminContent`: something an admin wrote or added for the product (#664): a name, description or short description,
 *   an uploaded image, a set specification, an added OEM / cross / barcode reference, an added vehicle. An SEO title or
 *   description, a category, brand, part number or price and every hide / remove decision do not count: they describe
 *   or withdraw what is already there, they add no fact.
 *
 * Measured on the local catalog (2026-11-15, 773,118 listed supplier rows): enrichment 80,207 (10.4%); with
 * description fitments ~353k (45.6%); with the supplier OEM 536,560 (69.4%), the threshold chosen. The ~236.5k bare
 * pages stay reachable as `noindex,follow` and enter the index once they gain a signal (the admin signal is not in
 * these counts; it is nil until an admin edits a product, and only adds pages). Stock was left out: it changes
 * with every 30-minute sync and would flip ~62k pages in and out of the sitemap.
 *
 * The product sitemap selects the same rows in SQL (src/modules/seo/sitemap.server.ts, `minimumContentSql`);
 * scripts/test-sitemap.ts keeps the two in step.
 */
export const productIndexPolicy = {
  supplierCatalog: true,
  unavailable: false,
  // The OR's order is the SQL's: the cheap row-local conditions first, the admin lookup last.
  minimumContent: ["enrichment", "descriptionFitment", "supplierOem", "adminContent"],
} as const satisfies { supplierCatalog: boolean; unavailable: boolean; minimumContent: readonly (keyof ProductContent)[] };

export type ProductContent = { enrichment: boolean; descriptionFitment: boolean; supplierOem: boolean; adminContent: boolean };

// A text counts when it has a character String.prototype.trim() would keep (hasAdminContent): not whitespace, NBSP or BOM.
const nonBlank = String.raw`'[^[:space:]\u00a0\ufeff]'`;

/**
 * Each signal as a SQL condition over the supplier row `i` (commerce_supplier_items), its enrichment link `l`
 * (product_enrichment_shared_links, LEFT JOIN on supplier_item_id) and its admin override `h` (commerce_item_overrides,
 * LEFT JOIN on supplier_item_id). They mirror the page's loaders: getProductEnrichment (the link's code and brand are
 * the row's), getDescriptionFitments (the row and its grouped offers) and the catalog's `oem` column. `adminContent` reads
 * the product's admin tables through product_sources, uncorrelated (the planner hashes the product ids once, not per row).
 */
export const contentSignals: Record<keyof ProductContent, { sql: string }> = {
  enrichment: { sql: "(l.supplier_item_id IS NOT NULL AND l.supplier_code=i.code AND l.supplier_brand=COALESCE(NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'))" },
  descriptionFitment: { sql: `(EXISTS (SELECT 1 FROM product_model_fitments f WHERE f.supplier_item_id=i.id)
   OR EXISTS (SELECT 1 FROM product_offers o JOIN product_model_fitments f ON f.supplier_item_id=o.item_id WHERE o.primary_id=i.id))` },
  supplierOem: { sql: "(COALESCE(i.product_data->>'oe','')<>'' AND h.hide_oem IS NOT TRUE)" },
  // If admin edits grow to tens of thousands of products, switch to the correlated EXISTS form: the hashed SubPlan depends on work_mem.
  adminContent: { sql: `(i.id IN (SELECT ps.supplier_item_id FROM product_sources ps WHERE ps.product_id IN (
     SELECT po.product_id FROM product_overrides po WHERE po.name ~ ${nonBlank} OR po.description ~ ${nonBlank} OR po.short_description ~ ${nonBlank}
     UNION ALL SELECT pi.product_id FROM product_override_images pi
     UNION ALL SELECT sp.product_id FROM product_override_specs sp WHERE sp.action='set'
     UNION ALL SELECT pr.product_id FROM product_override_references pr WHERE pr.action='add'
     UNION ALL SELECT pf.product_id FROM product_override_fitments pf WHERE pf.mode='add')))` },
};

/**
 * The admin's edits of a product as the page's loaders return them (getItemOverride, getItemImages, getItemReferences,
 * getItemSpecs, getItemFitments); typed structurally so this module stays free of the store's server-only code.
 */
export type AdminEdits = {
  override: { name: string | null; description: string | null; short_description: string | null } | null;
  images: readonly unknown[];
  specs: readonly { action: string }[];
  references: readonly { action: string }[];
  addedVehicles: readonly unknown[];
};

/** The page's view of `adminContent`; mirrors the SQL condition above. */
export function hasAdminContent(edits: AdminEdits): boolean {
  const text = (value: string | null | undefined) => (value ?? "").trim() !== "";
  const { override } = edits;
  return (override != null && (text(override.name) || text(override.description) || text(override.short_description)))
    || edits.images.length > 0 || edits.specs.some(spec => spec.action === "set")
    || edits.references.some(reference => reference.action === "add") || edits.addedVehicles.length > 0;
}

/** The page's view of the signals: its enrichment (null when none matches), description fitments, shown OEM and admin content. */
export function productContent(input: { enrichment: unknown; descriptionModels: readonly unknown[]; oem: string; adminContent: boolean }): ProductContent {
  return { enrichment: input.enrichment != null, descriptionFitment: input.descriptionModels.length > 0, supplierOem: input.oem !== "", adminContent: input.adminContent };
}

export function hasMinimumContent(content: ProductContent): boolean {
  return productIndexPolicy.minimumContent.some(signal => content[signal]);
}

/** The SQL condition of `hasMinimumContent`. */
export function minimumContentSql(): string {
  return `(${productIndexPolicy.minimumContent.map(signal => contentSignals[signal].sql).join("\n  OR ")})`;
}

export function productIndexable(product: { supplier: string; source: "store" | "supplier"; unavailable?: boolean }, content: ProductContent): boolean {
  if (product.supplier === "demo") return false;
  if (product.unavailable) return productIndexPolicy.unavailable;
  if (product.source === "store") return true;
  return productIndexPolicy.supplierCatalog && hasMinimumContent(content);
}

/**
 * The fewest products a vehicle model listing needs to be indexed (#639); below it the page is `noindex,follow`
 * and stays out of the sitemap, and a model with no product at all is a 404. Measured on the local catalog
 * (2026-11-15; listed products, engine-level ∪ description fitments). Model pages: the 4,372 units of
 * vehicleModelGroups; model × category: the planning prototype's 4,744 units (before code-less series merged).
 *
 * | at least | model pages | model × category | make × category |
 * | -------- | ----------- | ---------------- | --------------- |
 * | 1        | 4,089       | 107,788          | 5,866           |
 * | 5        | 3,597       | 17,539           | 2,252           |
 * | 10       | 3,226       | 7,094            | 1,312           |
 * | 20       | 2,884       | 2,955            | 669             |
 * | 50       | 2,326       | 1,055            | 243             |
 *
 * (Numbered code-less series later became units of their own: 4,442 units; the table keeps its measured counts.)
 *
 * At 10, 74% of the model pages stay indexable (283 have no product: 404) while the one- and two-product
 * model × category and make × category pages (#673) stay out. The same threshold gates all three (isGatedListing); a
 * gated listing without any product is a 404. The plain make and category pages keep the plain-listing rule.
 */
export const minIndexableListingProducts = 10;

/** Listings held to the product minimum (#639, #673): a model page, with or without a category, and a make × category page. */
export const isGatedListing = (query: Pick<CatalogQuery, "make" | "model" | "category">) => Boolean(query.model || (query.make && query.category));

/** A plain listing (isIndexableListing) that, when gated, lists at least `minIndexableListingProducts` without its filters. */
export function listingIndexable(query: CatalogQuery, total: number): boolean {
  return isIndexableListing(query) && (!isGatedListing(query) || total >= minIndexableListingProducts);
}
