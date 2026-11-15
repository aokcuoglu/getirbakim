// The vehicle model pages' unit (#639): one model family and generation of a make, every body style together
// ("GOLF VII" + "GOLF VII Variant" + "GOLF VII Van" = /yedek-parca/volkswagen/golf-7). TecDoc lists a series per body
// style and has no family or generation field; the name carries them. Pure: client components may import it.
//
// Slug rules, unique within the make (scripts/test-vehicle-model-groups.ts pins the known addresses):
//  1. A roman generation after the family: `<family>-<n>` (golf-7, megane-3, clio-4).
//  2. A code word after the family: `<family>-<code>` (passat-b8, a4-b8, transporter-t5).
//  3. Else the series sharing a chassis code in brackets: `<family>-<code>`, the earliest series' first code
//     (tipo-356 = Saloon + Hatchback + Estate, 3-e90, c-class-w205).
//  4. Else a number right after the family names the model (tiggo-7, atto-3, seal-6, mg-5, r-1200): the number is the
//     model, not a generation, and `describe()` in description-fitment.ts reads it the same way.
//  5. Else (no code at all) the family's series whose production years overlap: `<family>-<start year>` (clio-2025).
//     A series without an end year ends where the family's next generation (4+ years later) starts, so
//     ford-usa/mustang-2004 stops at the 2014 Mustang.
//  6. A slug still taken goes to the earliest unit (production start, then id); a later one adds `-<lowest model id>`.
//
// Stability: a newer series (a later generation) keeps every existing address; at most it splits an open-ended unit,
// and the earlier part keeps the address. An address moves when the catalog gains a series that starts earlier than
// the unit it joins (the unit is named by its earliest series) or one that bridges two year ranges or chassis codes
// (it merges them). 141 such single-series additions were measured on the local catalog (2026-11-15): known limit.
// `npm run vehicles:slugs` (docs/vehicle-catalog.md) compares the addresses before and after a catalog import.
import { BODY, ROMAN, normalizeText } from "./description-fitment";
import type { VehicleModel } from "./vehicle-catalog";

export type VehicleModelGroup = {
  slug: string; name: string; family: string; generation: number | null; models: VehicleModel[];
  /** Earliest start and latest end of the members; null when one of them is unknown (start) or still built (end). */
  dateFrom: string | null; dateTo: string | null;
};

// Body styles the description matcher does not need (BODY stays as it is so its matching does not move).
const pageBody = new Set(["SUV", "GRANDTOUR", "BODY/MPV", "CARGO", "PICK-UP", "BODY", "LIFTBACK", "FASTBACK", "NOTCHBACK", "WAGON", "STATION",
  "CHASSIS", "PLATFORM", "DOUBLE", "CAB"]);
// "B8", "T5", also "B3/B4" and "B5.5" (slugs passat-b3-b4, passat-b5-5).
const codeWord = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9][A-Z0-9./]+$/;

const slugify = (value: string) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Parsed = { model: VehicleModel; familyKey: string; family: string; generation: number | null; wordCode: string | null; number: string | null;
  codes: string[] };

function parse(model: VehicleModel): Parsed {
  const original = model.name.split("(")[0].trim().split(/\s+/);
  const words = original.map(word => normalizeText(word));
  let length = 0;
  for (const [index, word] of words.entries()) {
    if (BODY.has(word) || pageBody.has(word) || (index && /\d/.test(word))) break;
    length++;
  }
  // A name starting with a body word ("CAB 4x4") still has a family: its first word.
  length = Math.max(length, 1);
  const rest = words.slice(length);
  // Bracketed chassis codes: "356_" → 356, "BZ0/1_" → BZ0, "5G1, BQ1" → 5G1 and BQ1.
  const codes = [...model.name.matchAll(/\(([^)]*)\)/g)].flatMap(([, inner]) => normalizeText(inner).split(/[,\s]+/)
    .map(code => code.split("/")[0].replace(/[^A-Z0-9]/g, "")).filter(Boolean));
  return { model, familyKey: words.slice(0, length).join(" "), family: original.slice(0, length).join(" "),
    generation: rest.map(word => ROMAN[word]).find(Boolean) ?? null, wordCode: rest.find(word => codeWord.test(word)) ?? null,
    number: /^\d+$/.test(rest[0] ?? "") ? rest[0] : null, codes };
}

const start = (model: VehicleModel) => model.dateFrom ?? "9999-99";
const byAge = (a: VehicleModel, b: VehicleModel) => start(a).localeCompare(start(b)) || Number(a.id) - Number(b.id);
const monthBefore = (date: string) => {
  const [year, month] = date.split("-").map(Number);
  return month > 1 ? `${year}-${String(month - 1).padStart(2, "0")}` : `${year - 1}-12`;
};
const overlaps = (a: { from: string; to: string }, from: string, to: string) => from <= a.to && a.from <= to;

type Draft = { slug: string; name: string; family: string; generation: number | null; models: VehicleModel[] };

/** One make's series grouped into model pages, oldest first; see the slug rules above. Independent of input order. */
export function vehicleModelGroups(models: VehicleModel[]): VehicleModelGroup[] {
  const drafts = new Map<string, Draft>();
  const add = (key: string, slug: string, name: string, parsed: Parsed) => {
    const draft = drafts.get(key) ?? { slug, name, family: parsed.family, generation: parsed.generation, models: [] };
    draft.models.push(parsed.model);
    drafts.set(key, draft);
  };
  const families = new Map<string, Parsed[]>();
  for (const parsed of [...models].sort(byAge).map(parse)) families.set(parsed.familyKey, [...families.get(parsed.familyKey) ?? [], parsed]);
  for (const [familyKey, members] of families) {
    const family = members[0].family, familySlug = slugify(familyKey);
    // An open end closes where the family's next generation starts, four years or more later: the same rule as the
    // description matcher's (description-fitment.ts), so a series still listed "to today" does not swallow the later ones.
    const starts = members.flatMap(({ model }) => model.dateFrom ? [model.dateFrom] : []);
    const endOf = (model: VehicleModel) => {
      if (model.dateTo || !model.dateFrom) return model.dateTo ?? "9999";
      const next = starts.filter(date => Number(date.slice(0, 4)) >= Number(model.dateFrom!.slice(0, 4)) + 4).sort()[0];
      return next ? monthBefore(next) : "9999";
    };
    const coded: { codes: Set<string>; members: Parsed[] }[] = [], plain: { from: string; to: string; members: Parsed[] }[] = [];
    for (const parsed of members) {
      if (parsed.generation) add(`${familyKey}|g${parsed.generation}`, `${familySlug}-${parsed.generation}`, `${family} ${parsed.generation}`, parsed);
      else if (parsed.wordCode) add(`${familyKey}|w${parsed.wordCode}`, `${familySlug}-${slugify(parsed.wordCode)}`, `${family} ${parsed.wordCode}`, parsed);
      else if (parsed.number && !parsed.codes.length) add(`${familyKey}|n${parsed.number}`, `${familySlug}-${parsed.number}`, `${family} ${parsed.number}`, parsed);
      else if (parsed.codes.length) {
        // Series sharing any code are one unit; a series bridging two units joins them.
        const hits = coded.filter(cluster => parsed.codes.some(code => cluster.codes.has(code)));
        const cluster = hits[0] ?? { codes: new Set<string>(), members: [] };
        if (!hits.length) coded.push(cluster);
        for (const other of hits.slice(1)) {
          for (const code of other.codes) cluster.codes.add(code);
          cluster.members.push(...other.members);
          coded.splice(coded.indexOf(other), 1);
        }
        cluster.members.push(parsed);
        for (const code of parsed.codes) cluster.codes.add(code);
      } else {
        const from = parsed.model.dateFrom ?? "0000", to = endOf(parsed.model);
        const range = plain.find(cluster => overlaps(cluster, from, to));
        const cluster = range ?? { from: "9999", to: "0000", members: [] };
        if (!range) plain.push(cluster);
        cluster.members.push(parsed);
        cluster.from = [cluster.from, from].sort()[0];
        cluster.to = [cluster.to, to].sort()[1];
      }
    }
    for (const cluster of coded) {
      const first = [...cluster.members].sort((a, b) => byAge(a.model, b.model))[0];
      for (const parsed of cluster.members) add(`${familyKey}|c${first.model.id}`, `${familySlug}-${slugify(first.codes[0])}`, `${family} (${first.codes[0]})`, parsed);
    }
    for (const cluster of plain) {
      const first = [...cluster.members].sort((a, b) => byAge(a.model, b.model))[0];
      const suffix = first.model.dateFrom?.slice(0, 4) ?? first.model.id;
      for (const parsed of cluster.members) add(`${familyKey}|y${first.model.id}`, `${familySlug}-${suffix}`, `${family} (${suffix})`, parsed);
    }
  }
  const taken = new Set<string>();
  return [...drafts.values()].map(draft => ({ ...draft, models: draft.models.sort(byAge) }))
    .sort((a, b) => byAge(a.models[0], b.models[0]))
    .map(({ slug: base, name, family, generation, models: members }) => {
      let slug = base;
      if (taken.has(slug)) {
        const lowest = Math.min(...members.map(model => Number(model.id)));
        slug = `${base}-${lowest}`;
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${lowest}-${n}`;
      }
      taken.add(slug);
      const froms = members.map(model => model.dateFrom), tos = members.map(model => model.dateTo);
      return { slug, name, family, generation, models: members,
        dateFrom: froms.some(date => date === null) ? null : (froms as string[]).sort()[0],
        dateTo: tos.some(date => date === null) ? null : (tos as string[]).sort().at(-1) ?? null };
    });
}

export type VehicleModelFamilyGroups = { family: string; groups: VehicleModelGroup[] };

/** Model pages by family (A→Z, numbers in order), each family's generations newest first: the make page's list. */
export function vehicleModelGroupFamilies(groups: VehicleModelGroup[]): VehicleModelFamilyGroups[] {
  const families = new Map<string, VehicleModelGroup[]>();
  for (const group of groups) {
    const key = normalizeText(group.family);
    families.set(key, [...families.get(key) ?? [], group]);
  }
  return [...families.values()].map(list => ({ family: list[0].family,
    groups: list.sort((a, b) => (b.dateFrom ?? "").localeCompare(a.dateFrom ?? "") || a.slug.localeCompare(b.slug)) }))
    .sort((a, b) => a.family.localeCompare(b.family, "tr", { numeric: true }));
}

/** Production years for titles and copy: "2012–2022", "2019–günümüz"; null without a start. */
export function vehicleModelGroupYears(group: Pick<VehicleModelGroup, "dateFrom" | "dateTo">) {
  if (!group.dateFrom) return null;
  return `${group.dateFrom.slice(0, 4)}–${group.dateTo?.slice(0, 4) ?? "günümüz"}`;
}
