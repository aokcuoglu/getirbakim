// Snapshots of the vehicle model page addresses (#639) and their comparison: run before and after a vehicle catalog
// import (npm run vehicles:slugs, docs/vehicle-catalog.md) to see which public addresses an import lost or changed.
// Pure: the script reads the database.
import { vehicleModelGroups } from "./vehicle-model-groups";
import type { VehicleModel } from "./vehicle-catalog";

/** Make id → model slug → the unit's series (id and name); names make the report readable. */
export type SlugSnapshot = { makes: Record<string, { name: string; slugs: Record<string, { id: string; name: string }[]> }> };

export function slugSnapshot(makes: { id: string; name: string; models: VehicleModel[] }[]): SlugSnapshot {
  return { makes: Object.fromEntries(makes.map(make => [make.id, { name: make.name,
    slugs: Object.fromEntries(vehicleModelGroups(make.models).map(group => [group.slug, group.models.map(({ id, name }) => ({ id, name }))])) }])) };
}

export type SlugChange = { make: string; slug: string; added: string[]; removed: string[] };
export type SlugLoss = { make: string; slug: string; series: string[]; movedTo: string[] };
export type SlugComparison = { lost: SlugLoss[]; changed: SlugChange[]; added: number; kept: number };

/**
 * Addresses of `before` against `after`: `lost` ones no longer exist (the page would 404; `movedTo` names where their
 * series went), `changed` ones exist with another set of series (the page now lists other vehicles).
 */
export function compareSlugSnapshots(before: SlugSnapshot, after: SlugSnapshot): SlugComparison {
  const lost: SlugLoss[] = [], changed: SlugChange[] = [];
  let kept = 0, added = 0;
  for (const [makeId, make] of Object.entries(before.makes)) {
    const now = after.makes[makeId]?.slugs ?? {};
    const where = new Map(Object.entries(now).flatMap(([slug, series]) => series.map(({ id }) => [id, slug] as const)));
    for (const [slug, series] of Object.entries(make.slugs)) {
      const current = now[slug];
      if (!current) {
        lost.push({ make: make.name, slug, series: series.map(item => `${item.id} ${item.name}`),
          movedTo: [...new Set(series.map(item => where.get(item.id)).filter((value): value is string => Boolean(value)))] });
        continue;
      }
      const was = new Set(series.map(item => item.id)), is = new Set(current.map(item => item.id));
      const removed = series.filter(item => !is.has(item.id)).map(item => `${item.id} ${item.name}`);
      const gained = current.filter(item => !was.has(item.id)).map(item => `${item.id} ${item.name}`);
      if (removed.length || gained.length) changed.push({ make: make.name, slug, added: gained, removed });
      else kept++;
    }
  }
  for (const [makeId, make] of Object.entries(after.makes)) {
    const old = before.makes[makeId]?.slugs ?? {};
    added += Object.keys(make.slugs).filter(slug => !old[slug]).length;
  }
  return { lost, changed, added, kept };
}
