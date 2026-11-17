import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { formatNumber } from "./format";
import { productFitmentLimit } from "./product-fitment-fields";
import { fitmentSourceLabel, modelYearRange } from "./product-label";
import {
  automaticTypesSql, changeProductFitments, insertAddedFitments, recordFitmentChange, vehicleColumns, vehicleJoins,
  type FitmentVehicle, type ProductFitmentResult,
} from "./product-fitment-store";
import { compact, searchEquivalentTargets } from "./product-target-search";

type Queryable = Pick<Pool, "query"> | PoolClient;

/** A product whose vehicle fitments can be copied (#662): a linked equivalent or a search hit. */
export type FitmentCopySource = { id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; equivalent: boolean };

/** Rows the copy preview lists; the rest is counted. */
export const fitmentCopyPreviewRows = 50;

/** The new types of one vehicle model in a copy (#815): the admin picks the models (or whole makes) to copy. */
export type FitmentCopyGroup = { brandId: number; brand: string; modelId: number; model: string; /** Production years ("2006–2013"), to tell same-name generations apart (#888). */ years: string | null; count: number };

/** A source type with its model and make, so a copy can be limited to chosen models (#815). */
export type CopyVehicle = FitmentVehicle & { modelId: number; brandId: number; years: string | null };

/** What a copy from another product would write (#662). */
export type FitmentCopyPreview = {
  source: { id: string; brand_label: string; code: string; name: string | null };
  /** The source's effective types: automatic ones it did not remove, plus the ones added to it. */
  total: number;
  /** The first fitmentCopyPreviewRows types the copy adds, by make, model and engine. */
  add: CopyVehicle[];
  addCount: number;
  /** Every model with new types, by make and model, its count of them (all together addCount). */
  groups: FitmentCopyGroup[];
  /** Source types the target has decided already (added or removed) or fits automatically: not copied. */
  skipped: { added: number; removed: number; automatic: number };
  /** How many decisions the target can still take (productFitmentLimit). */
  remaining: number;
  /** Copying every new type needs more decisions than the target has left: only some models can be copied (#815). */
  exceeds: boolean;
  /** The target has decisions already; without them the first one makes the store drop the model-level lists. */
  targetHasDecisions: boolean;
};

type CopyPlan = Pick<FitmentCopyPreview, "total" | "skipped" | "remaining" | "groups"> & { add: CopyVehicle[] };

/**
 * Products to copy fitments from: without a query the product's linked equivalents, with one the equivalent search
 * (part number, supplier code, OEM number). The product itself and merged products are never listed.
 */
export async function loadFitmentCopySources(database: Pick<Pool, "query">, productId: string, query: string | undefined): Promise<{ q: string; sources: FitmentCopySource[] }> {
  // A query without letters or digits ("-", "/") lists the equivalents too.
  if (!compact(query)) {
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
  const source = (await database.query<FitmentVehicle & { modelId: number; brandId: number; yearFrom: string | null; yearTo: string | null }>(`WITH ${automaticTypesSql},
      decisions AS (SELECT vehicle_type_id AS id,mode FROM product_override_fitments WHERE product_id=$1),
      effective AS (SELECT id FROM automatic WHERE id NOT IN (SELECT id FROM decisions WHERE mode='remove')
        UNION SELECT id FROM decisions WHERE mode='add')
    SELECT ${vehicleColumns},m.id AS "modelId",b.id AS "brandId",
      to_char(m.date_from,'YYYY') AS "yearFrom",to_char(m.date_to,'YYYY') AS "yearTo" FROM effective x JOIN vehicle_types v ON v.id=x.id ${vehicleJoins}
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
  const add: CopyVehicle[] = [];
  // In the source's order: by make and model.
  const groups = new Map<number, FitmentCopyGroup>();
  for (const { yearFrom, yearTo, ...row } of source) {
    const vehicle: CopyVehicle = { ...row, years: modelYearRange(yearFrom, yearTo) };
    const decision = decided.get(vehicle.typeId);
    if (decision === "add") skipped.added++;
    else if (decision === "remove") skipped.removed++;
    else if (automatic.has(vehicle.typeId)) skipped.automatic++;
    else {
      add.push(vehicle);
      const group = groups.get(vehicle.modelId);
      if (group) group.count++;
      else groups.set(vehicle.modelId, { brandId: vehicle.brandId, brand: vehicle.brand, modelId: vehicle.modelId, model: vehicle.model, years: vehicle.years, count: 1 });
    }
  }
  return { total: source.length, add, groups: [...groups.values()], skipped, remaining: Math.max(0, productFitmentLimit - decided.size) };
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
    total: plan.total, add: plan.add.slice(0, fitmentCopyPreviewRows), addCount: plan.add.length, groups: plan.groups, skipped: plan.skipped,
    remaining: plan.remaining, exceeds: plan.add.length > plan.remaining, targetHasDecisions: plan.remaining < productFitmentLimit,
  };
}

/**
 * Copies the source's effective types onto the target as added types (no carried_from: the admin decided them here),
 * in the source's order, then writes the copy's summary as the newest history row. `modelIds` limits the copy to the
 * new types of those models (#815); without it every new type is copied. `expected` is the count the admin saw in the
 * preview for that choice: another count means the products changed meanwhile ("stale"). Only the target is locked.
 */
export async function copyProductFitments(database: Pick<Pool, "connect">, targetId: string, sourceId: string, expected: number, adminId: string, modelIds?: readonly number[]) {
  return changeProductFitments(database, targetId, async (client): Promise<ProductFitmentResult> => {
    const source = targetId === sourceId ? undefined : await productIdentity(client, sourceId);
    if (!source || source.merged_into) return { ok: false, reason: "bad-source" };
    const plan = await planFitmentCopy(client, targetId, sourceId);
    if (!plan.add.length) return { ok: false, reason: "nothing-to-copy" };
    // The server reads the choice against its own plan: a model without new types adds nothing.
    const chosenModels = modelIds ? new Set(modelIds) : null;
    const chosen = chosenModels ? plan.add.filter(vehicle => chosenModels.has(vehicle.modelId)) : plan.add;
    if (chosen.length !== expected) return { ok: false, reason: "stale" };
    if (chosen.length > plan.remaining) return { ok: false, reason: "limit" };
    // The copied rows and the summary share one batch: the history shows them as one line, "Geri al" takes them back (#816, #817).
    const batchId = randomUUID();
    await insertAddedFitments(client, targetId, chosen.map(vehicle => vehicle.typeId), adminId, batchId);
    const models = new Set(chosen.map(vehicle => vehicle.modelId)).size;
    const part = chosen.length < plan.add.length ? ` (${formatNumber(models)} model seçildi)` : "";
    await recordFitmentChange(client, targetId, "fitment_copied", null,
      `${fitmentSourceLabel(source.brand_label, source.code)} ürününden ${formatNumber(chosen.length)} araç tipi${part}`, adminId, batchId);
    return { ok: true, added: chosen.length, batchId };
  });
}
