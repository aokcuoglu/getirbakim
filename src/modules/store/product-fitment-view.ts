// The product page's "Uyumlu araçlar" (#642): the fitment rows grouped by model on the server, in the fewest fields the
// client component prints, so a product with 1,500 vehicles does not ship every row's labels and ids twice (HTML and RSC
// payload). Client-safe: no server modules; the labels come in computed (vehicle-label.ts).

/** An engine row's fields by name (fitmentRowFields). */
export type FitmentRowFields = {
  /** The source's engine and engine codes; searched and printed under the catalog's name when that differs. */
  engine: string;
  fuel: string; ps: number; kw: number; cc: number; from: string; to?: string;
  /** The linked catalog engine type. */
  typeId?: number;
  /** The catalog engine type's name, only where it differs from `engine`. */
  catalog?: string;
};
/**
 * An engine row as the page's props and /api/product-fitments carry it: a tuple, so the field names do not repeat per
 * row (#1211). The optional fields follow the required ones; a missing one before a present one is "" / 0, missing
 * trailing ones are left off. Built by fitmentRow, read by fitmentRowFields.
 */
export type FitmentRow = [engine: string, fuel: string, ps: number, kw: number, cc: number, from: string, to?: string, typeId?: number, catalog?: string];

/** The tuple of a row's fields. */
export function fitmentRow({ engine, fuel, ps, kw, cc, from, to, typeId, catalog }: FitmentRowFields): FitmentRow {
  if (catalog) return [engine, fuel, ps, kw, cc, from, to ?? "", typeId ?? 0, catalog];
  if (typeId) return [engine, fuel, ps, kw, cc, from, to ?? "", typeId];
  return to ? [engine, fuel, ps, kw, cc, from, to] : [engine, fuel, ps, kw, cc, from];
}

/** A row's fields by name; a "" / 0 gap reads as missing. */
export function fitmentRowFields([engine, fuel, ps, kw, cc, from, to, typeId, catalog]: FitmentRow): FitmentRowFields {
  return { engine, fuel, ps, kw, cc, from, to: to || undefined, typeId: typeId || undefined, catalog: catalog || undefined };
}
/**
 * One model series: `make` is the make as the catalog writes it (the filter's value), `model` its reading-form label.
 * `count` marks a group whose engine rows the page holds back (#1324): `rows` is empty and `count` is how many there are.
 */
export type FitmentGroup = { make: string; model: string; href?: string; rows: FitmentRow[]; count?: number };
/**
 * `groupCount` is every model group of the product; `groups` the printed ones. A product with more than
 * `fitmentInitialGroups` groups ships only the first ones (#966), and printed groups past `fitmentInlineRows` engine rows
 * ship without their rows (#1324): `rest` is then the URL of the whole list (/api/product-fitments/[id]) and, from
 * `fitmentInitialGroups` up to `fitmentEagerModelOptions` groups, `models` fills the model select.
 */
export type FitmentView = {
  makes: [string, string][]; groups: FitmentGroup[]; total: number; groupCount: number;
  models?: [string, string][]; rest?: string;
};

/**
 * Model groups printed before "Tüm {n} modeli göster", kept low for a heavy-fitment product page's HTML budget (#1211,
 * ≤ 150 KB: the printed groups' engine rows ship as props); the rest loads from /api/product-fitments/[id] (#966).
 */
export const fitmentInitialGroups = 6;
/**
 * Above this many models the model select fills its options when first pointed at or focused; a page that ships part of
 * the list (#966) sends the model names up to this many, past it the select waits for the whole list.
 */
export const fitmentEagerModelOptions = 50;
/**
 * Engine rows the printed groups may carry in the page's props (#1324): past this many, whole or nothing, every printed
 * group ships its row count only and its rows load from /api/product-fitments/[id] when a group is opened (the heaviest
 * product pages carried 94–101 rows, ~8–10 KB, in closed panels).
 */
export const fitmentInlineRows = 24;

/** A group's engine rows, printed or held back. */
export const fitmentRowCount = (group: FitmentGroup) => group.count ?? group.rows.length;

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
    group.rows.push(fitmentRow({ engine: vehicle.engineAndCodes, fuel: vehicle.fuel, ps: vehicle.ps, kw: vehicle.kw, cc: vehicle.cc, from: vehicle.from,
      to: vehicle.to || undefined, typeId: vehicle.vehicleTypeId || undefined,
      catalog: vehicle.catalogEngine && vehicle.catalogEngine !== vehicle.engineAndCodes ? vehicle.catalogEngine : undefined }));
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

const printedRows = (view: FitmentView) =>
  view.groups.slice(0, fitmentInitialGroups).reduce((sum, group) => sum + fitmentRowCount(group), 0);

/** Whether the page ships the view as it is: up to `fitmentInitialGroups` groups with up to `fitmentInlineRows` rows. */
export const fitmentShipsWhole = (view: FitmentView) => view.groupCount <= fitmentInitialGroups && printedRows(view) <= fitmentInlineRows;

/**
 * The view the product page ships (#966, #1324): a short list whole; past `fitmentInitialGroups` groups the first
 * groups, the URL of the rest and, up to `fitmentEagerModelOptions` groups, the model select's [make, model] pairs.
 * Printed groups with more than `fitmentInlineRows` rows in all ship their counts only; `keepFirst` (a garage vehicle's
 * group leads) keeps the first group's rows when it has up to `fitmentInlineRows`.
 */
export function initialFitmentView(full: FitmentView, restUrl: string, keepFirst = false): FitmentView {
  if (fitmentShipsWhole(full)) return full;
  const printed = full.groups.slice(0, fitmentInitialGroups);
  const groups = printedRows(full) <= fitmentInlineRows ? printed : printed.map((group, index): FitmentGroup =>
    keepFirst && index === 0 && group.rows.length <= fitmentInlineRows ? group
      : { make: group.make, model: group.model, ...(group.href ? { href: group.href } : {}), rows: [], count: group.rows.length });
  const models = full.groupCount > fitmentInitialGroups && full.groupCount <= fitmentEagerModelOptions;
  return {
    makes: full.makes, groups, total: full.total, groupCount: full.groupCount, rest: restUrl,
    ...(models ? { models: full.groups.map((group): [string, string] => [group.make, group.model]) } : {}),
  };
}

/**
 * Whether a loaded group has this shape: a model and tuple rows. An older deploy answers object rows (before #1211), which
 * the page must reject rather than read.
 */
export function isFitmentGroup(value: unknown): value is FitmentGroup {
  return typeof value === "object" && value !== null && "model" in value && typeof value.model === "string"
    && "rows" in value && Array.isArray(value.rows) && value.rows.every(row => Array.isArray(row) && typeof row[0] === "string");
}

/**
 * The printed groups first, then the loaded ones they do not hold, in order. A printed group with its rows stays the same
 * object (open rows stay open); one held back (#1324) takes the loaded group of its model in its place, or leaves when the
 * loaded list no longer has it.
 */
export function mergeFitmentGroups(printed: readonly FitmentGroup[], all: readonly FitmentGroup[]): FitmentGroup[] {
  const loaded = new Map(all.map(group => [group.model, group]));
  const seen = new Set(printed.map(group => group.model));
  const kept = printed.flatMap(group => {
    if (group.count === undefined) return [group];
    const found = loaded.get(group.model);
    return found ? [found] : [];
  });
  return [...kept, ...all.filter(group => !seen.has(group.model))];
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
 * (also the ones not loaded yet: `groupCount` counts them). A group whose rows are held back (#1324) matches a make or
 * model with all its rows and a search by its model name only, until the list loads.
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
    if (group.count !== undefined) {
      if (normalized && !fold(group.model).includes(normalized)) continue;
      groups.push(group);
      matches += group.count;
      continue;
    }
    const rows = normalized ? group.rows.filter(row => {
      const { engine, from, to, ps, kw } = fitmentRowFields(row);
      return fold(`${group.model} ${engine} ${from} ${to ?? ""} ${ps} ${kw}`).includes(normalized);
    }) : group.rows;
    if (!rows.length) continue;
    groups.push(rows === group.rows ? group : { ...group, rows });
    matches += rows.length;
  }
  return { groups, matches, hidden: 0 };
}

/**
 * What the load-failure alert adds about the search it could not finish: held-back rows (#1324) were searched by model
 * name only, and groups not loaded yet (#966) not at all.
 */
export function fitmentFailureNote(view: FitmentView, { searching, filtering }: { searching: boolean; filtering: boolean }) {
  const someHidden = view.groupCount > view.groups.length;
  if (searching && view.groups.some(group => group.count !== undefined)) {
    return someHidden ? ` Yalnız ilk ${view.groups.length} modelin adında arandı.` : " Yalnız model adlarında arandı.";
  }
  return filtering && someHidden ? ` Yalnız ilk ${view.groups.length} model içinde arandı.` : "";
}
