// The product page's fitment rows as the list prints them (#966): the page and /api/product-fitments/[id] build the same
// sources and version. Server side only (vehicle-label.ts reaches the product-name dictionary), but free of the database
// so the tests read it directly.
import { createHash } from "node:crypto";
import { fitmentLabels } from "./vehicle-label";
import type { FitmentGroup, FitmentSource } from "./product-fitment-view";

type FitmentVehicle = Omit<FitmentSource, "makeKey" | "makeLabel" | "modelLabel" | "modelHref"> & { model: string; catalogBrand?: string | null };

/** The shown vehicles with their readable make and model; a series the product's model page lists links it (#674). */
export function fitmentSources(vehicles: readonly FitmentVehicle[], makeNames: readonly string[], modelFits: ReadonlySet<number>,
  modelPaths: ReadonlyMap<number, string>): FitmentSource[] {
  return vehicles.map(row => ({ ...row, ...fitmentLabels(row, makeNames),
    modelHref: row.modelId && modelFits.has(row.modelId) ? modelPaths.get(row.modelId) ?? null : null }));
}

/**
 * The version of a product's whole list in its garage-independent order: the page puts it in the list's URL (`?v=`), so
 * a cache keeps one answer per list and a changed list gets a new URL.
 */
export const fitmentVersion = (groups: readonly FitmentGroup[]) =>
  createHash("sha1").update(JSON.stringify(groups)).digest("base64url").slice(0, 12);
