// The product page's fitment rows as the list prints them (#966): the page and /api/product-fitments/[id] build the same
// sources and version. Server side only (vehicle-label.ts reaches the product-name dictionary), but free of the database
// so the tests read it directly.
import { createHash } from "node:crypto";
import { fitmentLabels } from "./vehicle-label";
import { fitmentShipsWhole, fitmentView, initialFitmentView, type FitmentGarage, type FitmentSource, type FitmentView } from "./product-fitment-view";

type FitmentVehicle = Omit<FitmentSource, "makeKey" | "makeLabel" | "modelLabel" | "modelHref"> & { model: string; catalogBrand?: string | null };

/** The shown vehicles with their readable make and model; a series the product's model page lists links it (#674). */
export function fitmentSources(vehicles: readonly FitmentVehicle[], makeNames: readonly string[], modelFits: ReadonlySet<number>,
  modelPaths: ReadonlyMap<number, string>): FitmentSource[] {
  return vehicles.map(row => ({ ...row, ...fitmentLabels(row, makeNames),
    modelHref: row.modelId && modelFits.has(row.modelId) ? modelPaths.get(row.modelId) ?? null : null }));
}

/**
 * The version of a product's whole list in its garage-independent order: the page puts it in the list's URL (`?v=`), so
 * a cache keeps one answer per list and a changed list gets a new URL. The reference list (#1211) uses it too.
 */
export const fitmentVersion = (list: readonly unknown[]) =>
  createHash("sha1").update(JSON.stringify(list)).digest("base64url").slice(0, 12);

/** What the page and the route have read for a product's list: the shown vehicles, the catalog makes and model pages. */
export type ProductFitmentInput = {
  vehicles: readonly FitmentVehicle[]; makeNames: readonly string[]; modelFits: ReadonlySet<number>; modelPaths: ReadonlyMap<number, string>;
};

const canonicalFitment = (sources: FitmentSource[]) => {
  const { groups } = fitmentView(sources);
  return { v: fitmentVersion(groups), groups };
};

/** The whole list in the garage-independent order with its version: what /api/product-fitments/[id] answers. */
export const productFitmentGroups = (input: ProductFitmentInput) =>
  canonicalFitment(fitmentSources(input.vehicles, input.makeNames, input.modelFits, input.modelPaths));

/**
 * The view the product page ships: the garage vehicle's groups first, and past `fitmentInitialGroups` groups or
 * `fitmentInlineRows` printed engine rows (#1324) the URL of the whole list under the version productFitmentGroups gives
 * the route for the same input. A garage vehicle's leading group keeps its rows when it is short.
 */
export function productPageFitment(input: ProductFitmentInput, garage: FitmentGarage | null, productId: string): FitmentView | null {
  if (!input.vehicles.length) return null;
  const sources = fitmentSources(input.vehicles, input.makeNames, input.modelFits, input.modelPaths);
  const personal = fitmentView(sources, garage);
  if (fitmentShipsWhole(personal)) return personal;
  const { v } = garage ? canonicalFitment(sources) : { v: fitmentVersion(personal.groups) };
  return initialFitmentView(personal, `/api/product-fitments/${productId}?v=${v}`, Boolean(garage));
}
