// The product page's "Uyumlu araçlar" (#642): the fitment rows grouped by model on the server, in the fewest fields the
// client component prints, so a product with 1,500 vehicles does not ship every row's labels and ids twice (HTML and RSC
// payload). Client-safe: no server modules; the labels come in computed (vehicle-label.ts).

export type FitmentRow = {
  /** The source's engine and engine codes; searched and printed under the catalog's name when that differs. */
  engine: string;
  /** The catalog engine type's name, only where it differs from `engine`. */
  catalog?: string;
  fuel: string; ps: number; kw: number; cc: number; from: string; to?: string;
  /** The linked catalog engine type. */
  typeId?: number;
};
/** One model series: `make` is the make as the catalog writes it (the filter's value), `model` its reading-form label. */
export type FitmentGroup = { make: string; model: string; href?: string; rows: FitmentRow[] };
/**
 * `groupCount` is every model group of the product; `groups` the printed ones. A product with more than
 * `fitmentInitialGroups` groups ships only the first ones (#966): `rest` is the URL of the whole list
 * (/api/product-fitments/[id]) and, up to `fitmentEagerModelOptions` groups, `models` fills the model select.
 */
export type FitmentView = {
  makes: [string, string][]; groups: FitmentGroup[]; total: number; groupCount: number;
  models?: [string, string][]; rest?: string;
};

/** Model groups printed before "Tüm {n} modeli göster". */
export const fitmentInitialGroups = 20;
/**
 * Above this many models the model select fills its options when first pointed at or focused; a page that ships part of
 * the list (#966) sends the model names up to this many, past it the select waits for the whole list.
 */
export const fitmentEagerModelOptions = 50;

export type FitmentSource = {
  engineAndCodes: string; fuel: string; ps: number; kw: number; cc: number; from: string; to: string | null;
  makeKey: string; makeLabel: string; modelLabel: string;
  vehicleTypeId?: number | null; catalogEngine?: string | null;
  modelId?: number | null;
  /** The series' model page (#674); absent while the page does not list the product yet. */
  modelHref?: string | null;
};

/** The visitor's garage vehicle: its catalog engine type and model (fitmentVehicle) and its make's reading label. */
export type FitmentGarage = { typeId: string | null; modelId: string | null; makeLabel: string };

/**
 * The rows grouped by model label in first-seen order; a group links the first model page any of its rows names. Makes
 * are one entry per reading label, so "TOGG" and "Togg" spellings filter together under the first key seen. With a garage
 * vehicle its model's groups come first (its engine type, then its model, then its make), so the garage note's link to
 * the list lands on a printed group however many models there are.
 */
export function fitmentView(vehicles: readonly FitmentSource[], garage?: FitmentGarage | null): FitmentView {
  const makes = new Map<string, string>(), groups = new Map<string, FitmentGroup>(), rank = new Map<FitmentGroup, number>();
  for (const vehicle of vehicles) {
    const make = makes.get(vehicle.makeLabel) ?? vehicle.makeKey;
    makes.set(vehicle.makeLabel, make);
    let group = groups.get(vehicle.modelLabel);
    if (!group) groups.set(vehicle.modelLabel, group = { make, model: vehicle.modelLabel, rows: [] });
    // A label can join several series of one model page; the first linked one stands for it.
    if (!group.href && vehicle.modelHref) group.href = vehicle.modelHref;
    const row: FitmentRow = { engine: vehicle.engineAndCodes, fuel: vehicle.fuel, ps: vehicle.ps, kw: vehicle.kw, cc: vehicle.cc, from: vehicle.from };
    if (vehicle.catalogEngine && vehicle.catalogEngine !== vehicle.engineAndCodes) row.catalog = vehicle.catalogEngine;
    if (vehicle.to) row.to = vehicle.to;
    if (vehicle.vehicleTypeId) row.typeId = vehicle.vehicleTypeId;
    group.rows.push(row);
    if (garage) {
      const own = garage.typeId && String(vehicle.vehicleTypeId) === garage.typeId ? 0
        : garage.modelId && String(vehicle.modelId) === garage.modelId ? 1 : vehicle.makeLabel === garage.makeLabel ? 2 : 3;
      rank.set(group, Math.min(rank.get(group) ?? 3, own));
    }
  }
  // Array sort is stable: groups of one rank keep their first-seen order.
  const ordered = [...groups.values()].sort((a, b) => (rank.get(a) ?? 3) - (rank.get(b) ?? 3));
  return { makes: [...makes].map(([label, key]): [string, string] => [key, label]), groups: ordered, total: vehicles.length, groupCount: ordered.length };
}

/**
 * The view the product page ships (#966): with up to `fitmentInitialGroups` groups the whole view; past that the first
 * groups, the URL of the rest and, up to `fitmentEagerModelOptions` groups, the model select's [make, model] pairs.
 */
export function initialFitmentView(full: FitmentView, restUrl: string): FitmentView {
  if (full.groupCount <= fitmentInitialGroups) return full;
  return {
    makes: full.makes, groups: full.groups.slice(0, fitmentInitialGroups), total: full.total, groupCount: full.groupCount, rest: restUrl,
    ...(full.groupCount <= fitmentEagerModelOptions ? { models: full.groups.map((group): [string, string] => [group.make, group.model]) } : {}),
  };
}

/** The printed groups first (the same objects, so open rows stay open), then the loaded ones they do not hold, in order. */
export function mergeFitmentGroups(printed: readonly FitmentGroup[], all: readonly FitmentGroup[]): FitmentGroup[] {
  const seen = new Set(printed.map(group => group.model));
  return [...printed, ...all.filter(group => !seen.has(group.model))];
}

/**
 * The Cache-Control of /api/product-fitments/[id]: the page's version (`?v=`) names one list, so a matching one is kept
 * long; a stale or missing version (an old page, a hand-written URL) briefly.
 */
export function fitmentCacheControl(requested: string | null, current: string) {
  return requested === current ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" : "public, max-age=300";
}

// Turkish lower case turns the roman "VII" into "vıı"; folding ı to i on both sides keeps "golf vii" a match.
const fold = (text: string) => text.toLocaleLowerCase("tr").replaceAll("ı", "i");

export type FitmentFilter = { make: string; model: string; query: string; showAll: boolean };

/**
 * The groups to print: with a make, model or search, every group with a matching row (only its matching rows); without
 * them the first `fitmentInitialGroups` until `showAll`. `matches` counts the matching rows, `hidden` the groups held back
 * (also the ones not loaded yet: `groupCount` counts them).
 */
export function visibleFitmentGroups(view: FitmentView, { make, model, query, showAll }: FitmentFilter) {
  const normalized = fold(query.trim());
  if (!make && !model && !normalized) {
    const groups = showAll ? view.groups : view.groups.slice(0, fitmentInitialGroups);
    return { groups, matches: view.total, hidden: view.groupCount - groups.length };
  }
  const groups: FitmentGroup[] = [];
  let matches = 0;
  for (const group of view.groups) {
    if ((make && group.make !== make) || (model && group.model !== model)) continue;
    const rows = normalized ? group.rows.filter(row => fold(`${group.model} ${row.engine} ${row.from} ${row.to ?? ""} ${row.ps} ${row.kw}`).includes(normalized)) : group.rows;
    if (!rows.length) continue;
    groups.push(rows === group.rows ? group : { ...group, rows });
    matches += rows.length;
  }
  return { groups, matches, hidden: 0 };
}
