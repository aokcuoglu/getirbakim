import "server-only";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { sourceVehicleKey, type SourceVehicleFields } from "@/modules/store/product-fitment-display";
import { fitmentHideField, productFitmentAutomaticLimit, productFitmentHideLimit, type FitmentHideKind } from "./product-fitment-fields";
import { changeProductFitments, fitmentSourcesSql, recordFitmentChange, type ProductFitmentResult } from "./product-fitment-store";

/** A hidden source row (product_override_fitment_hides, #661): its row id and whether a merge carried it. */
export type FitmentHide = { id: string; carried: boolean };
/** An enrichment vehicle no catalog type is linked to, as the source words it; `key` is its sourceVehicleKey. */
export type SourceVehicleRow = SourceVehicleFields & { key: string; hidden: FitmentHide | null };
/** An entry of the enrichment's model list (payload.vehicleModels). */
export type SourceModelRow = { name: string; hidden: FitmentHide | null };
/** A model read from a supplier's description of one of the product's rows (product_model_fitments, #393). */
export type DescriptionModelRow = { modelId: number; brand: string; model: string; yearFrom: number | null; yearTo: number | null; hidden: FitmentHide | null };
/** A hidden row whose source no longer has it (reworded, dropped, or past the vehicle list's limit). */
export type OrphanHide = FitmentHide & { kind: FitmentHideKind; label: string };
/** A product's source rows the admin can leave out of the store (#661). */
export type ProductFitmentSources = {
  /** The product has a vehicle decision (#583): the store then uses neither model list. */
  decided: boolean;
  /** Unlinked enrichment vehicles, at most productFitmentAutomaticLimit, in the source's order. */
  vehicles: SourceVehicleRow[];
  /** How many unlinked vehicles the sources have in all. */
  vehiclesTotal: number;
  models: SourceModelRow[];
  descriptionModels: DescriptionModelRow[];
  orphans: OrphanHide[];
};
export type FitmentHideTarget = { kind: "source_vehicle" | "source_model"; key: string } | { kind: "description_model"; modelId: number };

type Queryable = Pick<Pool, "query"> | PoolClient;
type HideRow = { id: string; kind: FitmentHideKind; model_id: number | null; source_key: string | null; label: string; carried: boolean };

// The payload's vehicle fields (enrichmentDataSchema's); a malformed element is not shown, as the store does not show it.
const sourceVehicle = z.object({
  model: z.string().min(1), engineAndCodes: z.string().min(1), fuel: z.string(), kw: z.number(), ps: z.number(), cc: z.number(),
  from: z.string(), to: z.string().nullable(), typeId: z.number().optional(),
});
const parseVehicle = (value: unknown): SourceVehicleFields | null => {
  const parsed = sourceVehicle.safeParse(value);
  return parsed.success ? parsed.data : null;
};

// The donors' vehicles no catalog type is linked to at their index (getProductEnrichment's unlinked rows).
const unlinkedSql = (filter: string, limit: string) => `WITH ${fitmentSourcesSql}
  SELECT v.value AS vehicle,count(*) OVER ()::int AS total FROM sources x
  CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(x.vehicles) WHEN 'array' THEN x.vehicles ELSE '[]' END) WITH ORDINALITY v(value,n)
  WHERE NOT EXISTS (SELECT 1 FROM product_vehicle_fitments f WHERE f.supplier_item_id=x.donor_item_id AND f.source_index=v.n-1
    AND f.vehicle_type_id IS NOT NULL AND f.source_vehicle=v.value)${filter}
  ORDER BY x.donor_item_id,v.n ${limit}`;
const modelsSql = (filter: string) => `WITH ${fitmentSourcesSql}
  SELECT DISTINCT m.name FROM sources x
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE jsonb_typeof(x.models) WHEN 'array' THEN x.models ELSE '[]' END) m(name)
  WHERE true${filter} ORDER BY 1`;
const descriptionSql = (filter: string) => `SELECT DISTINCT ON (f.model_id) f.model_id AS "modelId",b.display_name AS brand,m.name AS model,
   f.year_from AS "yearFrom",f.year_to AS "yearTo"
  FROM product_sources s JOIN product_model_fitments f ON f.supplier_item_id=s.supplier_item_id
  JOIN vehicle_models m ON m.id=f.model_id JOIN vehicle_brands b ON b.id=m.brand_id
  WHERE s.product_id=$1${filter} ORDER BY f.model_id,f.year_from NULLS LAST`;

const years = (from: number | null, to: number | null) => from ? ` · ${from}–${to ?? ""}` : "";
const vehicleLabel = (vehicle: SourceVehicleFields) => `${vehicle.model} ${vehicle.engineAndCodes} · ${vehicle.from}–${vehicle.to ?? "…"}`.slice(0, 500);

/** The product's source rows with the ones the admin hid, for the "Kaynak satırları" card. */
export async function loadProductFitmentSources(database: Queryable, productId: string): Promise<ProductFitmentSources> {
  const [vehicles, models, description, hides, decided] = await Promise.all([
    database.query<{ vehicle: unknown; total: number }>(unlinkedSql("", `LIMIT ${productFitmentAutomaticLimit}`), [productId]),
    database.query<{ name: string }>(modelsSql(""), [productId]),
    database.query<Omit<DescriptionModelRow, "hidden">>(descriptionSql(""), [productId]),
    database.query<HideRow>(`SELECT id::text,kind,model_id,source_key,label,carried_from IS NOT NULL AS carried
      FROM product_override_fitment_hides WHERE product_id=$1 ORDER BY created_at,id`, [productId]),
    database.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM product_override_fitments WHERE product_id=$1) AS exists", [productId]),
  ]);
  const byKey = new Map(hides.rows.filter(row => row.source_key !== null).map(row => [`${row.kind}|${row.source_key}`, row]));
  const byModel = new Map(hides.rows.filter(row => row.kind === "description_model").map(row => [row.model_id, row]));
  const used = new Set<string>();
  const take = (row: HideRow | undefined): FitmentHide | null => {
    if (!row) return null;
    used.add(row.id);
    return { id: row.id, carried: row.carried };
  };
  // Two donors may list the same vehicle: it is one row here, as one hide covers both.
  const seen = new Set<string>();
  const sourceVehicles: SourceVehicleRow[] = [];
  for (const row of vehicles.rows) {
    const vehicle = parseVehicle(row.vehicle);
    if (!vehicle) continue;
    const key = sourceVehicleKey(vehicle);
    if (seen.has(key)) continue;
    seen.add(key);
    sourceVehicles.push({ ...vehicle, key, hidden: take(byKey.get(`source_vehicle|${key}`)) });
  }
  return {
    decided: decided.rows[0].exists,
    vehicles: sourceVehicles,
    vehiclesTotal: vehicles.rows[0]?.total ?? 0,
    models: models.rows.map(row => ({ name: row.name, hidden: take(byKey.get(`source_model|${row.name}`)) })),
    descriptionModels: description.rows.map(row => ({ ...row, hidden: take(byModel.get(row.modelId)) })),
    orphans: hides.rows.filter(row => !used.has(row.id)).map(row => ({ id: row.id, kind: row.kind, label: row.label, carried: row.carried })),
  };
}

/** The history label of a target the product's sources have, or null when they do not have it. */
async function sourceLabel(client: PoolClient, productId: string, target: FitmentHideTarget): Promise<string | null> {
  if (target.kind === "description_model") {
    const row = (await client.query<Omit<DescriptionModelRow, "hidden">>(descriptionSql(" AND f.model_id=$2"), [productId, target.modelId])).rows[0];
    return row ? `${row.brand} ${row.model}${years(row.yearFrom, row.yearTo)}`.slice(0, 500) : null;
  }
  if (target.kind === "source_model") {
    const found = (await client.query(modelsSql(" AND m.name=$2"), [productId, target.key])).rowCount;
    return found ? target.key.slice(0, 500) : null;
  }
  // The key names the vehicle's model and engine first: only those rows are parsed and compared.
  let fields: unknown;
  try { fields = JSON.parse(target.key); } catch { return null; }
  if (!Array.isArray(fields) || typeof fields[0] !== "string" || typeof fields[1] !== "string") return null;
  const rows = (await client.query<{ vehicle: unknown }>(
    unlinkedSql(" AND v.value->>'model'=$2 AND v.value->>'engineAndCodes'=$3", ""), [productId, fields[0], fields[1]])).rows;
  const vehicle = rows.map(row => parseVehicle(row.vehicle)).find(row => row && sourceVehicleKey(row) === target.key);
  return vehicle ? vehicleLabel(vehicle) : null;
}

/**
 * Leaves a source row out of the store for every row of the product: an unlinked enrichment vehicle, an entry of the
 * enrichment's model list or a model read from a supplier's description. Checked against the product's sources; the
 * history label is built here, never taken from the request.
 */
export async function hideProductFitment(database: Pick<Pool, "connect">, productId: string, target: FitmentHideTarget, adminId: string) {
  return changeProductFitments(database, productId, async (client): Promise<ProductFitmentResult> => {
    const label = await sourceLabel(client, productId, target);
    if (!label) return { ok: false, reason: "not-in-source" };
    const existing = target.kind === "description_model"
      ? await client.query("SELECT 1 FROM product_override_fitment_hides WHERE product_id=$1 AND kind='description_model' AND model_id=$2", [productId, target.modelId])
      : await client.query("SELECT 1 FROM product_override_fitment_hides WHERE product_id=$1 AND kind=$2 AND md5(source_key)=md5($3) AND source_key=$3", [productId, target.kind, target.key]);
    if (existing.rowCount) return { ok: false, reason: "unchanged" };
    const count = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_fitment_hides WHERE product_id=$1", [productId])).rows[0].n;
    if (count >= productFitmentHideLimit) return { ok: false, reason: "hide-limit" };
    await client.query(`INSERT INTO product_override_fitment_hides(product_id,kind,model_id,source_key,label,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [productId, target.kind, target.kind === "description_model" ? target.modelId : null, target.kind === "description_model" ? null : target.key, label, adminId]);
    await recordFitmentChange(client, productId, fitmentHideField(target.kind, "hidden"), null, label, adminId);
    return { ok: true };
  });
}

/** Shows a hidden source row again; "stale" when the row is gone already. */
export async function showProductFitment(database: Pick<Pool, "connect">, productId: string, rowId: string, adminId: string) {
  return changeProductFitments(database, productId, async (client): Promise<ProductFitmentResult> => {
    const shown = (await client.query<{ kind: FitmentHideKind; label: string }>(
      "DELETE FROM product_override_fitment_hides WHERE id=$1 AND product_id=$2 RETURNING kind,label", [rowId, productId])).rows[0];
    if (!shown) return { ok: false, reason: "stale" };
    await recordFitmentChange(client, productId, fitmentHideField(shown.kind, "shown"), shown.label, null, adminId);
    return { ok: true };
  });
}
