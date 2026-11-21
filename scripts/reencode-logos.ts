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
      // fitLogo keeps a logo that already fits, or whose re-encode would not be smaller, as it is.
      before += input.length;
      after += fit.bytes.length;
      if (!fit.changed) continue;
      changedFiles++;
      console.log(`${src} ${entries[0].width}x${entries[0].height} ${input.length} -> ${fit.width}x${fit.height} ${fit.bytes.length}`);
      if (apply) {
        await writeFile(`public${src}`, fit.bytes);
        for (const entry of entries) Object.assign(entry, { width: fit.width, height: fit.height, sha256: fit.sha256 });
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

// scripts/aws/db-tunnel.sh
const prodTunnelPort = "15432";

/** Where DATABASE_URL points, without the password. `--apply` against a non-default port needs `--yes-remote`. */
export function describeDatabase(connectionString: string | undefined) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const url = new URL(connectionString);
  return { host: url.host, port: url.port || "5432", user: decodeURIComponent(url.username), name: url.pathname.slice(1) };
}

export function assertApplyAllowed(port: string, yesRemote: boolean) {
  if (port === "5432" || yesRemote) return;
  const why = port === prodTunnelPort ? "the prod tunnel port" : "a non-default port";
  throw new Error(`Refusing --apply on port ${port} (${why}): pass --yes-remote only if this is really the intended database.`);
}

async function reencodeDb(apply: boolean, yesRemote: boolean) {
  const target = describeDatabase(process.env.DATABASE_URL);
  console.log(`Database: ${target.user}@${target.host}/${target.name}`);
  if (apply) assertApplyAllowed(target.port, yesRemote);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let skipped = 0;
  try {
    const rows = (await client.query<{ brand_key: string; image_data: Buffer; sha256: string }>(
      "SELECT brand_key,image_data,sha256 FROM manufacturer_logos ORDER BY brand_key")).rows;
    let before = 0, after = 0, changed = 0, updated = 0;
    if (apply) await client.query("BEGIN");
    try {
      for (const row of rows) {
        const fit = await fitLogo(row.image_data, logoBoxes.manufacturer, "png");
        before += row.image_data.length;
        if (!fit.changed) { after += row.image_data.length; continue; }
        after += fit.bytes.length;
        changed++;
        console.log(`${row.brand_key} ${row.image_data.length} -> ${fit.width}x${fit.height} ${fit.bytes.length}`);
        if (apply) {
          const count = await updateLogoRow(client, { brandKey: row.brand_key, oldSha256: row.sha256, bytes: fit.bytes, sha256: fit.sha256, width: fit.width, height: fit.height });
          if (count) updated++; else skipped++;
        }
      }
      if (apply) await client.query("COMMIT");
    } catch (error) {
      if (apply) await client.query("ROLLBACK");
      throw error;
    }
    console.log(`manufacturer_logos: ${changed}/${rows.length} rows change, ${before} -> ${after} bytes`
      + (apply ? ` (applied: ${updated} updated, ${skipped} skipped (sha changed))` : " (dry run)"));
  } finally {
    client.release();
    await pool.end();
  }
  if (skipped) process.exitCode = 1;
}

const knownFlags = new Set(["--apply", "--yes-remote"]);

async function main() {
  const [mode, ...flags] = process.argv.slice(2);
  const unknown = flags.filter((flag) => !knownFlags.has(flag));
  if (unknown.length) throw new Error(`Unknown flag: ${unknown.join(", ")}`);
  const apply = flags.includes("--apply");
  if (mode === "static") await reencodeStatic(apply);
  else if (mode === "db") await reencodeDb(apply, flags.includes("--yes-remote"));
  else throw new Error("Usage: logos:reencode -- static|db [--apply] [--yes-remote]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
