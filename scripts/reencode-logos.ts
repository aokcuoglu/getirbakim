import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { fitLogo, logoBoxes } from "../src/modules/store/logo-encode";

type Entry = { src: string; width: number; height: number; source: string; sha256: string; registryKey?: string };
type Registry = { vehicles: Record<string, Entry>; manufacturers: Record<string, Entry> };

const registryPath = "data/brand-logos.json";

async function reencodeStatic(apply: boolean) {
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
  const sets = [["vehicles", logoBoxes.vehicle], ["manufacturers", logoBoxes.manufacturer]] as const;
  for (const [set, box] of sets) {
    let before = 0, after = 0, changedFiles = 0;
    const bySrc = new Map<string, Entry[]>();
    for (const entry of Object.values(registry[set])) bySrc.set(entry.src, [...(bySrc.get(entry.src) ?? []), entry]);
    for (const [src, entries] of bySrc) {
      const input = await readFile(`public${src}`);
      const fit = await fitLogo(input, box, "webp");
      // A logo already inside the box is kept as is (no second lossy pass); an oversized one is always resized.
      const keep = !fit.changed;
      const out = keep ? { bytes: input, width: entries[0].width, height: entries[0].height, sha256: entries[0].sha256 } : fit;
      before += input.length;
      after += out.bytes.length;
      if (keep) continue;
      changedFiles++;
      console.log(`${src} ${entries[0].width}x${entries[0].height} ${input.length} -> ${out.width}x${out.height} ${out.bytes.length}`);
      if (apply) {
        await writeFile(`public${src}`, out.bytes);
        for (const entry of entries) Object.assign(entry, { width: out.width, height: out.height, sha256: out.sha256 });
      }
    }
    console.log(`${set}: ${changedFiles}/${bySrc.size} files change, ${before} -> ${after} bytes`);
  }
  if (apply) await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
}

export async function updateLogoRow(client: PoolClient, row: { brandKey: string; oldSha256: string; bytes: Buffer; sha256: string; width: number; height: number }) {
  const result = await client.query(
    "UPDATE manufacturer_logos SET image_data=$2,sha256=$3,width=$4,height=$5 WHERE brand_key=$1 AND sha256=$6",
    [row.brandKey, row.bytes, row.sha256, row.width, row.height, row.oldSha256],
  );
  return result.rowCount ?? 0;
}

async function reencodeDb(apply: boolean) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  console.log(`Database: ${url.hostname}${url.pathname}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const rows = (await client.query<{ brand_key: string; image_data: Buffer; sha256: string }>(
      "SELECT brand_key,image_data,sha256 FROM manufacturer_logos ORDER BY brand_key")).rows;
    let before = 0, after = 0, changed = 0;
    if (apply) await client.query("BEGIN");
    try {
      for (const row of rows) {
        const fit = await fitLogo(row.image_data, logoBoxes.manufacturer, "png");
        before += row.image_data.length;
        if (!fit.changed) { after += row.image_data.length; continue; }
        after += fit.bytes.length;
        changed++;
        console.log(`${row.brand_key} ${row.image_data.length} -> ${fit.width}x${fit.height} ${fit.bytes.length}`);
        if (apply) await updateLogoRow(client, { brandKey: row.brand_key, oldSha256: row.sha256, bytes: fit.bytes, sha256: fit.sha256, width: fit.width, height: fit.height });
      }
      if (apply) await client.query("COMMIT");
    } catch (error) {
      if (apply) await client.query("ROLLBACK");
      throw error;
    }
    console.log(`manufacturer_logos: ${changed}/${rows.length} rows change, ${before} -> ${after} bytes${apply ? " (applied)" : " (dry run)"}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const [mode, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  if (mode === "static") await reencodeStatic(apply);
  else if (mode === "db") await reencodeDb(apply);
  else throw new Error("Usage: logos:reencode -- static|db [--apply]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
