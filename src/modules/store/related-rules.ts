import { oilPackQuantity } from "./maintenance-kit";
import { oilMatches, vehicleOilFilters, type OilFilter, type ProductOilSpec, type VehicleOilSpec } from "./vehicle-oil";

/**
 * What else a shopper usually needs after putting a part in the cart (#704): per Trodo category, the categories of the parts
 * fitted together with it, most useful first. Another brand of the same part is an equivalent, not a related item, so a
 * category never lists itself. Engine oil is suggested with oil filters; fluids carry no fitment.
 */
export const complementaryCategories: Readonly<Record<number, readonly number[]>> = {
  // fren-diskleri → fren-balatalari, balata-asinma-sensorleri, fren-hidroligi
  269: [268, 281, 960],
  // fren-balatalari → fren-diskleri, balata-asinma-sensorleri, fren-hidroligi
  268: [269, 281, 960],
  // balata-asinma-sensorleri → fren-balatalari, fren-diskleri
  281: [268, 269],
  // fren-pabuclari → fren-kampanalari, tekerlek-fren-merkezleri, el-freni-telleri
  273: [274, 279, 282],
  // fren-kampanalari → fren-pabuclari, tekerlek-fren-merkezleri
  274: [273, 279],
  // yag-filtreleri → motor-yaglari, hava-filtreleri, polen-filtreleri, yakit-filtreleri
  242: [957, 243, 246, 244],
  // hava-filtreleri → yag-filtreleri, polen-filtreleri, yakit-filtreleri
  243: [242, 246, 244],
  // polen-filtreleri → hava-filtreleri, yag-filtreleri
  246: [243, 242],
  // yakit-filtreleri → yag-filtreleri, hava-filtreleri
  244: [242, 243],
  // motor-yaglari → yag-filtreleri, hava-filtreleri, polen-filtreleri
  957: [242, 243, 246],
  // bujiler → atesleme-bobinleri, buji-kablolari
  327: [326, 329],
  // atesleme-bobinleri → bujiler, buji-kablolari
  326: [327, 329],
  // triger-kayis-setleri → su-pompalari, v-ve-kanalli-kayislar, sogutma-sivilari
  185: [299, 175, 961],
  // triger-kayislari → triger-kayisi-gergi-rulmanlari, triger-kayisi-avare-rulmanlari, su-pompalari
  184: [186, 187, 299],
  // su-pompalari → triger-kayis-setleri, termostatlar, sogutma-sivilari
  299: [185, 303, 961],
  // v-ve-kanalli-kayislar → kanalli-kayis-avare-ve-kilavuz-rulmanlari, alternator-serbest-donus-kasnaklari
  175: [178, 195],
  // v-ve-kanalli-kayis-setleri → su-pompalari
  171: [299],
  // amortisorler → amortisor-rulmanlari-ve-takozlari, amortisor-korukleri, helezon-yaylar
  665: [668, 671, 664],
  // amortisor-rulmanlari-ve-takozlari → amortisorler, amortisor-korukleri
  668: [665, 671],
  // helezon-yaylar → amortisorler, amortisor-rulmanlari-ve-takozlari
  664: [665, 668],
  // debriyaj-setleri → volanlar, hidrolik-debriyaj-rulmanlari
  824: [832, 830],
  // volanlar → debriyaj-setleri, hidrolik-debriyaj-rulmanlari
  832: [824, 830],
  // sogutma-radyatorleri → termostatlar, radyator-hortumlari-ve-borulari, sogutma-sivilari
  310: [303, 306, 961],
  // termostatlar → su-pompalari, sogutma-sivilari
  303: [299, 961],
  // salincaklar → rotiller, suspansiyon-burclari, viraj-aski-rotlari
  713: [723, 721, 719],
  // rotiller → salincaklar, rot-baslari
  723: [713, 677],
  // rot-baslari → rotiller, viraj-aski-rotlari
  677: [723, 719],
  // viraj-aski-rotlari → suspansiyon-burclari, rot-baslari
  719: [721, 677],
  // porya-rulmanlari → fren-diskleri, fren-balatalari
  703: [269, 268],
  // silecek → silecek-kollari, cam-suyu-pompalari
  607: [610, 609],
  // farlar → on-sis-farlari, sinyal-lambalari
  951: [898, 926],
  // stop-lambalari → sinyal-lambalari, arka-sis-lambalari
  914: [926, 935],
};

/**
 * Fluids and additives (motor, şanzıman yağları, fren hidroliği, soğutma sıvıları, yakıt/yağ katkıları): sold by
 * specification, not by vehicle, so a vehicle never rules them out.
 */
export const universalCategories: ReadonlySet<number> = new Set([957, 958, 960, 961, 962, 1075]);

/**
 * Fluids never used to fill the dialog of a product in the key category, both ways. Engine and transmission oil (#715): a
 * gearbox oil change is another job with another specification, and a second "oil" next to the one just added reads like
 * a duplicate or a wrong pick; brake fluid, coolant and oil additives remain.
 */
export const unrelatedFluids: Readonly<Record<number, readonly number[]>> = {
  // motor-yaglari → sanziman-yaglari
  957: [958],
  // sanziman-yaglari → motor-yaglari
  958: [957],
};

/**
 * Categories whose own kind of product is also named in other categories (#733): "yağ filtresi" products sit under yakıt
 * filtreleri, şanzıman and direksiyon hidrolik filtreleri, so neither the complement list nor the filler of an oil filter
 * may suggest a product named like one (a second "oil filter" reads as a duplicate). Matched against the product name.
 */
export const sameTypeNames: Readonly<Record<number, RegExp>> = {
  242: /ya[gğ][ıiİ]?\s*f[iıİ]ltre/i,
  245: /ya[gğ][ıiİ]?\s*f[iıİ]ltre/i,
  685: /ya[gğ][ıiİ]?\s*f[iıİ]ltre/i,
};

/** The name pattern of the kind of product in `path` (root first), by its deepest category with one; null when none. */
export function sameTypeName(path: readonly number[]): RegExp | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const rule = sameTypeNames[path[i]];
    if (rule) return rule;
  }
  return null;
}

/** The categories suggested for a product in `path` (root first): the deepest category with an entry. */
export function complementsFor(path: readonly number[]): readonly number[] {
  for (let i = path.length - 1; i >= 0; i--) {
    const complements = complementaryCategories[path[i]];
    if (complements) return complements;
  }
  return [];
}

export type RelatedInput = {
  /** Candidate ids per complementary category, in the order the categories are suggested. */
  complements: { categoryId: number; ids: readonly string[] }[];
  /**
   * How well a candidate fits the shopper's vehicle (shared models, or 1 for the garage vehicle's parts); null when no
   * vehicle is known. A part of a vehicle-specific category is kept only with a positive score: a part whose fit is
   * unknown may not fit. Fluids (universalCategories) are always kept.
   */
  fitScore: ReadonlyMap<string, number> | null;
  /** The added product, its offers and equivalents, and what is already in the cart. */
  exclude: ReadonlySet<string>;
  /** At most this many candidates per category. */
  perCategory: number;
  /** Categories whose ids come ranked already (engine oil, rankOils): kept in the given order, not sorted. */
  ordered?: ReadonlySet<number>;
  /**
   * The added product: ties among fluids (outside `ordered`) break by stableHash(seed:id), so different products get
   * different fluids and the same product the same ones. Without it ties break by id.
   */
  seed?: string;
};

/**
 * Ranks the candidates: within a category the best fitting first (vehicle-specific parts not known to fit are dropped),
 * ties stable (by id, or for fluids by the seed's hash), then the categories take turns, so three suggestions are a pad, a
 * sensor and a fluid rather than three pads.
 */
export function pickRelated(input: RelatedInput): { id: string; categoryId: number }[] {
  const seen = new Set<string>();
  const lists = input.complements.map(({ categoryId, ids }) => {
    const universal = universalCategories.has(categoryId);
    const score = (id: string) => input.fitScore?.get(id) ?? 0;
    const kept = [...new Set(ids)].filter(id => !input.exclude.has(id)).filter(id => universal || score(id) > 0);
    if (input.ordered?.has(categoryId)) return { categoryId, ranked: kept };
    const { seed } = input;
    const tie = universal && seed !== undefined
      ? (a: string, b: string) => stableHash(`${seed}:${a}`) - stableHash(`${seed}:${b}`) || (a < b ? -1 : a > b ? 1 : 0)
      : (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return { categoryId, ranked: kept.sort((a, b) => score(b) - score(a) || tie(a, b)) };
  });
  const picked: { id: string; categoryId: number }[] = [];
  const taken = new Map<number, number>();
  for (;;) {
    let added = false;
    for (const { categoryId, ranked } of lists) {
      if ((taken.get(categoryId) ?? 0) >= input.perCategory) continue;
      // The next candidate not already listed under an earlier category.
      const id = ranked.find(candidate => !seen.has(candidate));
      if (id === undefined) continue;
      ranked.splice(0, ranked.indexOf(id) + 1);
      seen.add(id); taken.set(categoryId, (taken.get(categoryId) ?? 0) + 1);
      picked.push({ id, categoryId }); added = true;
    }
    if (!added) return picked;
  }
}

/**
 * The section a filler may come from, one level above the product's category: the main group under "Yedek parça" for a
 * 3-level path (Fren sistemi for a disc, 3 → 252 → 269), the sub-group for a 4-level one (Gergi, kasnak ve damperler
 * for an idler pulley, 3 → 4 → 10036 → 187: all of Motor would bring oil caps and valve seals), the top category of a
 * shallow tree (Yağlar ve sıvılar for engine oil, 956 → 957). The whole "Yedek parça" tree would let a water pump fill
 * a brake disc's dialog.
 */
export const fillerSection = (path: readonly number[]) => path[Math.max(0, Math.min(path.length - 2, 2))];

/** FNV-1a (32 bit): a stable, well-spread number for a text; the same in every process. */
export function stableHash(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

/** A sellable engine oil in a pack a shopper carries home: its stated specs and litres per pack. */
export type OilCandidate = { id: string; spec: ProductOilSpec; litres: number };
/** A recommended engine oil (a vehicle type's, or a group of the added product's fitted types) and how many types share it. */
export type OilTarget = { spec: VehicleOilSpec; weight: number };
export type OilRankOptions = {
  /** The added product: ties break by stableHash(seed:oil), the same oil for the same product, different ones across products. */
  seed: string;
  /** The garage vehicle's recommendation: an oil matching none of it is not suggested (no guessing, as in Bakım Robotu). */
  strict: boolean;
  /** The litres to fill; unknown counts as 4, so a 1 L top-up bottle ranks behind a 4–5 L can. */
  capacityLitres?: number | null;
};

/**
 * The litres to fill for several targets (the added product's fitted types): the type-weighted mean of the capacities
 * known; undefined when none is (rankOils then assumes 4 L).
 */
export function targetCapacity(targets: readonly OilTarget[]) {
  const known = targets.filter(target => target.spec.capacityMax !== null && target.spec.capacityMax > 0);
  const weight = known.reduce((sum, target) => sum + target.weight, 0);
  return weight > 0 ? known.reduce((sum, target) => sum + target.spec.capacityMax! * target.weight, 0) / weight : undefined;
}

const viscosityOnly: ReadonlySet<OilFilter> = new Set(["viscosity"]);

/**
 * Engine oils best first for the targets (#715): the most target weight whose viscosity grade the oil has, then the most
 * whose every stated filter (grade and ACEA class or approval) it meets, then the fewest packs for the capacity, then the
 * seed's hash. A target the oil data cannot filter by is ignored; with no usable target only packs and hash decide. Strict
 * drops the oils matching no target (only when a usable target exists).
 */
export function rankOils(oils: readonly OilCandidate[], targets: readonly OilTarget[], options: OilRankOptions): string[] {
  const usable = targets.map(target => ({ ...target, filters: new Set(vehicleOilFilters(target.spec)) })).filter(target => target.filters.size > 0);
  const capacity = options.capacityLitres && options.capacityLitres > 0 ? options.capacityLitres : 4;
  const scored = oils.map(oil => {
    let grade = 0, full = 0;
    for (const target of usable) {
      if (target.filters.has("viscosity") && oilMatches(oil.spec, target.spec, viscosityOnly)) grade += target.weight;
      if (oilMatches(oil.spec, target.spec, target.filters)) full += target.weight;
    }
    return { id: oil.id, grade, full, packs: oilPackQuantity(capacity, oil.litres), hash: stableHash(`${options.seed}:${oil.id}`) };
  });
  return scored
    .filter(oil => !(options.strict && usable.length) || oil.grade > 0 || oil.full > 0)
    .sort((a, b) => b.grade - a.grade || b.full - a.full || a.packs - b.packs || a.hash - b.hash || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(oil => oil.id);
}
