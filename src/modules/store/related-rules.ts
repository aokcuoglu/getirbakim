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
   * How well a candidate fits the added product's vehicle (shared models, or 1 for the garage vehicle's parts).
   * null: no vehicle context; candidates are ranked by category only.
   */
  fitScore: ReadonlyMap<string, number> | null;
  /** Candidates with any vehicle fitment: with a vehicle context, one of these that does not fit it is dropped. */
  hasFitData: ReadonlySet<string>;
  /** The added product, its offers and equivalents, and what is already in the cart. */
  exclude: ReadonlySet<string>;
  /** At most this many candidates per category. */
  perCategory: number;
};

/**
 * Ranks the candidates: within a category the best fitting first (ties by id, so the result is stable), then the
 * categories take turns, so three suggestions are a pad, a sensor and a fluid rather than three pads.
 */
export function pickRelated(input: RelatedInput): { id: string; categoryId: number }[] {
  const seen = new Set<string>();
  const lists = input.complements.map(({ categoryId, ids }) => {
    const universal = universalCategories.has(categoryId);
    const score = (id: string) => input.fitScore?.get(id) ?? 0;
    const ranked = [...new Set(ids)]
      .filter(id => !input.exclude.has(id))
      .filter(id => universal || !input.fitScore || score(id) > 0 || !input.hasFitData.has(id))
      .sort((a, b) => score(b) - score(a) || (a < b ? -1 : a > b ? 1 : 0));
    return { categoryId, ranked };
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
