import type { PoolClient } from "pg";

export type BundleItem = { id: string; supplier?: string; company?: string; list_group?: string; warehouse?: string; code?: string };
type Row = Record<string, unknown>;
type Manifest = { items?: BundleItem[]; enrichments?: Row[]; products?: Row[]; logos?: Row[] };

// supplier_items.id is gen_random_uuid(), assigned by whichever database ran the supplier sync. After the AWS
// cutover production and the local catalog sync suppliers separately, so a product listed after the cutover has a
// different id on each side. A bundle therefore carries the natural key of every supplier item it references
// (manifest.items), and the importer resolves each one to the local row by that key.

/** Supplier item ids the bundle rows refer to. */
export function referencedItemIds(manifest: Manifest) {
  const ids = [
    ...(manifest.enrichments ?? []).map(row => row.supplier_item_id),
    ...(manifest.products ?? []).map(row => row.supplier_item_id),
    ...(manifest.logos ?? []).map(row => row.evidence_product_id),
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
}

/** The bundle's items; a bundle written before items existed falls back to its ids alone. */
export function bundleItems(manifest: Manifest): BundleItem[] {
  return manifest.items ?? referencedItemIds(manifest).map(id => ({ id }));
}

/**
 * Creates the transaction-scoped table bundle_items(bundle_id, id): every bundle item with the local id it resolves
 * to, by natural key first and by id otherwise; id is null when the product exists in neither way.
 */
export async function resolveBundleItems(client: PoolClient, items: BundleItem[]) {
  await client.query(`CREATE TEMP TABLE bundle_items ON COMMIT DROP AS
    SELECT b.id AS bundle_id, coalesce(k.id, i.id) AS id
    FROM jsonb_to_recordset($1::jsonb) AS b(id uuid, supplier text, company text, list_group text, warehouse text, code text)
    LEFT JOIN supplier_items k ON k.supplier=b.supplier AND k.company=b.company AND k.list_group=b.list_group AND k.warehouse=b.warehouse AND k.code=b.code
    LEFT JOIN supplier_items i ON i.id=b.id`, [JSON.stringify(items)]);
  const { rows } = await client.query<{ items: number; rekeyed: number; missing: number }>(`SELECT count(*)::int AS items,
    count(*) FILTER (WHERE id IS NOT NULL AND id<>bundle_id)::int AS rekeyed, count(*) FILTER (WHERE id IS NULL)::int AS missing FROM bundle_items`);
  return rows[0];
}
