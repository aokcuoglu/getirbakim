import "server-only";
import type { Pool, PoolClient } from "pg";
import { formatNumber } from "./format";
import { productFitmentLimit } from "./product-fitment-fields";
import {
  automaticTypesSql, changeProductFitments, insertAddedFitments, recordFitmentChange, vehicleColumns, vehicleJoins,
  type FitmentVehicle, type ProductFitmentResult,
} from "./product-fitment-store";
import { searchEquivalentTargets } from "./product-target-search";

type Queryable = Pick<Pool, "query"> | PoolClient;

/** A product whose vehicle fitments can be copied (#662): a linked equivalent or a search hit. */
export type FitmentCopySource = { id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; equivalent: boolean };

/** Rows the copy preview lists; the rest is counted. */
export const fitmentCopyPreviewRows = 50;

/** What a copy from another product would write (#662). */
export type FitmentCopyPreview = {
  source: { id: string; brand_label: string; code: string; name: string | null };
  /** The source's effective types: automatic ones it did not remove, plus the ones added to it. */
  total: number;
  /** The first fitmentCopyPreviewRows types the copy adds, by make, model and engine. */
  add: FitmentVehicle[];
  addCount: number;
  /** Source types the target has decided already (added or removed) or fits automatically: not copied. */
  skipped: { added: number; removed: number; automatic: number };
  /** How many decisions the target can still take (productFitmentLimit). */
  remaining: number;
  /** The copy needs more decisions than the target has left: it is refused, never copied in part. */
  exceeds: boolean;
  /** The target has decisions already; without them the first one makes the store drop the model-level lists. */
  targetHasDecisions: boolean;
};

type CopyPlan = Pick<FitmentCopyPreview, "total" | "skipped" | "remaining"> & { add: FitmentVehicle[] };

/**
 * Products to copy fitments from: without a query the product's linked equivalents, with one the equivalent search
 * (part number, supplier code, OEM number). The product itself and merged products are never listed.
 */
export async function loadFitmentCopySources(database: Pick<Pool, "query">, productId: string, query: string | undefined): Promise<{ q: string; sources: FitmentCopySource[] }> {
  if (!query?.trim()) {
    const sources = (await database.query<FitmentCopySource>(`SELECT p.id,p.brand_label,p.code,p.name,p.suppliers,true AS equivalent
      FROM product_equivalents e JOIN products p ON p.id=e.equivalent_id AND p.merged_into IS NULL
      WHERE e.product_id=$1 ORDER BY p.suppliers='{}',p.brand_label,p.code LIMIT 30`, [productId])).rows;
    return { q: "", sources };
  }
  const { q, targets } = await searchEquivalentTargets(database, productId, query);
  return { q, sources: targets.map(({ id, brand_label, code, name, suppliers, equivalent }) => ({ id, brand_label, code, name, suppliers, equivalent })) };
}

/**
 * The copy of source's effective types onto target. Automatic types of the target are skipped (an admin pins them one
 * by one), as are the types the target has decided; the source's removed types and hidden rows are not copied.
 */
async function planFitmentCopy(database: Queryable, targetId: string, sourceId: string): Promise<CopyPlan> {
  // One client runs one query at a time: awaited in turn, not in parallel.
  const source = (await database.query<FitmentVehicle>(`WITH ${automaticTypesSql},
      decisions AS (SELECT vehicle_type_id AS id,mode FROM product_override_fitments WHERE product_id=$1),
      effective AS (SELECT id FROM automatic WHERE id NOT IN (SELECT id FROM decisions WHERE mode='remove')
        UNION SELECT id FROM decisions WHERE mode='add')
    SELECT ${vehicleColumns} FROM effective x JOIN vehicle_types v ON v.id=x.id ${vehicleJoins}
    ORDER BY b.display_name,m.name,v.name,v.year_of_constr_from,v.id`, [sourceId])).rows;
  const target = (await database.query<{ id: number; kind: "automatic" | "add" | "remove" }>(`WITH ${automaticTypesSql}
    SELECT id,'automatic' AS kind FROM automatic
    UNION ALL SELECT vehicle_type_id,mode FROM product_override_fitments WHERE product_id=$1`, [targetId])).rows;
  const decided = new Map<number, "add" | "remove">();
  const automatic = new Set<number>();
  for (const row of target) {
    if (row.kind === "automatic") automatic.add(row.id);
    else decided.set(row.id, row.kind);
  }
  const skipped = { added: 0, removed: 0, automatic: 0 };
  const add: FitmentVehicle[] = [];
  for (const vehicle of source) {
    const decision = decided.get(vehicle.typeId);
    if (decision === "add") skipped.added++;
    else if (decision === "remove") skipped.removed++;
    else if (automatic.has(vehicle.typeId)) skipped.automatic++;
    else add.push(vehicle);
  }
  return { total: source.length, add, skipped, remaining: Math.max(0, productFitmentLimit - decided.size) };
}

const productIdentity = async (database: Queryable, id: string) => (await database.query<{ id: string; brand_label: string; code: string; name: string | null; merged_into: string | null }>(
  "SELECT id,brand_label,code,name,merged_into FROM products WHERE id=$1", [id])).rows[0];

/** The copy preview; null when either product is missing or merged or both are the same product. */
export async function previewFitmentCopy(database: Pick<Pool, "query">, targetId: string, sourceId: string): Promise<FitmentCopyPreview | null> {
  if (targetId === sourceId) return null;
  const [target, source] = await Promise.all([productIdentity(database, targetId), productIdentity(database, sourceId)]);
  if (!target || target.merged_into || !source || source.merged_into) return null;
  const plan = await planFitmentCopy(database, targetId, sourceId);
  return {
    source: { id: source.id, brand_label: source.brand_label, code: source.code, name: source.name },
    total: plan.total, add: plan.add.slice(0, fitmentCopyPreviewRows), addCount: plan.add.length, skipped: plan.skipped,
    remaining: plan.remaining, exceeds: plan.add.length > plan.remaining, targetHasDecisions: plan.remaining < productFitmentLimit,
  };
}

/**
 * Copies the source's effective types onto the target as added types (no carried_from: the admin decided them here),
 * in the source's order, then writes the copy's summary as the newest history row. `expected` is the count the
 * admin saw in the preview: another count means the products changed meanwhile ("stale"). Only the target is locked.
 */
export async function copyProductFitments(database: Pick<Pool, "connect">, targetId: string, sourceId: string, expected: number, adminId: string) {
  return changeProductFitments(database, targetId, async (client): Promise<ProductFitmentResult> => {
    const source = targetId === sourceId ? undefined : await productIdentity(client, sourceId);
    if (!source || source.merged_into) return { ok: false, reason: "bad-source" };
    const plan = await planFitmentCopy(client, targetId, sourceId);
    if (!plan.add.length) return { ok: false, reason: "nothing-to-copy" };
    if (plan.add.length !== expected) return { ok: false, reason: "stale" };
    if (plan.add.length > plan.remaining) return { ok: false, reason: "limit" };
    await insertAddedFitments(client, targetId, plan.add.map(vehicle => vehicle.typeId), adminId);
    await recordFitmentChange(client, targetId, "fitment_copied", null,
      `${source.brand_label} ${source.code} ürününden ${formatNumber(plan.add.length)} araç tipi`, adminId);
    return { ok: true, added: plan.add.length };
  });
}
