import { readFile, writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import type { VehicleModel } from "../src/modules/store/vehicle-catalog";
import { compareSlugSnapshots, slugSnapshot, type SlugSnapshot } from "../src/modules/store/vehicle-model-slug-snapshot";

// npm run vehicles:slugs -- snapshot <file.json> | compare <file.json> (#639, docs/vehicle-catalog.md). Read-only.
// `snapshot` writes the vehicle model page addresses of every make; `compare` lists the addresses the file has and
// the catalog no longer does (lost: the page would 404) or has with other series (changed). Exit code 1 on lost ones.
const [mode, file] = process.argv.slice(2);
if ((mode !== "snapshot" && mode !== "compare") || !file) throw new Error("Usage: vehicles:slugs -- snapshot|compare <file.json>");

async function current(): Promise<SlugSnapshot> {
  const { rows } = await db.query<VehicleModel & { brandName: string }>(`SELECT m.id::text, m.brand_id::text AS "brandId", m.name, b.name AS "brandName",
    to_char(m.date_from, 'YYYY-MM') AS "dateFrom", to_char(m.date_to, 'YYYY-MM') AS "dateTo" FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id`);
  const makes = new Map<string, { id: string; name: string; models: VehicleModel[] }>();
  for (const { brandName, ...model } of rows) {
    const make = makes.get(model.brandId) ?? { id: model.brandId, name: brandName, models: [] };
    make.models.push(model);
    makes.set(model.brandId, make);
  }
  return slugSnapshot([...makes.values()]);
}

try {
  const after = await current();
  if (mode === "snapshot") {
    await writeFile(file, JSON.stringify(after));
    console.log(`${Object.values(after.makes).reduce((sum, make) => sum + Object.keys(make.slugs).length, 0)} addresses of ${Object.keys(after.makes).length} makes written to ${file}`);
  } else {
    const result = compareSlugSnapshots(JSON.parse(await readFile(file, "utf8")) as SlugSnapshot, after);
    console.log(`kept ${result.kept}, new ${result.added}, changed ${result.changed.length}, lost ${result.lost.length}`);
    for (const loss of result.lost) console.log(`LOST ${loss.make}/${loss.slug} -> ${loss.movedTo.join(", ") || "nowhere"}: ${loss.series.join("; ")}`);
    for (const change of result.changed) console.log(`CHANGED ${change.make}/${change.slug}: +[${change.added.join("; ")}] -[${change.removed.join("; ")}]`);
    if (result.lost.length) process.exitCode = 1;
  }
} finally {
  await db.end();
}
