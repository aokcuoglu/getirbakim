import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import sharp from "sharp";
import { objectStorage } from "../src/lib/object-storage";
import { storeProductImage } from "../src/modules/enrichment/import";

// Cuts the white studio background out of the REPXPERT vehicle pictures (vehicle_type_images) with BiRefNet, so a car
// sits on any stage. Each picture is processed once, however many types share it; the transparent WebP replaces
// media_id and the original stays in original_media_id. Pictures the collection stores later are cut on the next run.
//
//   npm run vehicles:cutout -- run [--limit=N]
//   npm run vehicles:cutout -- status
//   npm run vehicles:cutout -- restore      (puts every original back)
//
// Needs rembg (https://github.com/danielgatis/rembg): python3 -m venv .local/rembg && .local/rembg/bin/pip install "rembg[cpu,cli]"
// REMBG_BIN overrides the binary; the model (~900 MB) downloads into ~/.rembg on first use.

const run = promisify(execFile);
const REMBG = resolve(process.env.REMBG_BIN || ".local/rembg/bin/rembg");
const MODEL = "birefnet-general";
const BATCH = 25;

const args = process.argv.slice(2);
const command = args.find(arg => !arg.startsWith("--")) ?? "status";
const limit = Number(args.find(arg => arg.startsWith("--limit="))?.slice(8)) || Infinity;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Pending = { media_id: string; bucket: string; object_key: string; source_url: string; reused: string | null; width: number | null; height: number | null };

async function status() {
  const { rows: [row] } = await pool.query<{ pictures: number; cut: number; types: number; typesCut: number }>(`SELECT
      count(DISTINCT COALESCE(original_media_id, media_id))::int AS pictures, count(DISTINCT original_media_id)::int AS cut,
      count(*)::int AS types, count(original_media_id)::int AS "typesCut" FROM vehicle_type_images`);
  console.log(`${row.cut}/${row.pictures} pictures cut out (${row.typesCut}/${row.types} vehicle types)`);
}

async function cutout() {
  // A type that shares an already cut original (stored after the cut-out) takes the existing cut-out without rembg.
  const { rows } = await pool.query<Pending>(`SELECT DISTINCT ON (i.media_id) i.media_id, m.bucket, m.object_key, m.source_url,
      done.media_id AS reused, done.width, done.height
    FROM vehicle_type_images i JOIN product_media_objects m ON m.id=i.media_id
    LEFT JOIN LATERAL (SELECT d.media_id, d.width, d.height FROM vehicle_type_images d WHERE d.original_media_id=i.media_id LIMIT 1) done ON true
    WHERE i.original_media_id IS NULL ORDER BY i.media_id`);
  const reused = rows.filter(row => row.reused);
  for (const row of reused) await replace(row.media_id, row.reused!, row.width!, row.height!);
  const pending = rows.filter(row => !row.reused).slice(0, limit);
  console.log(`${reused.length} pictures took an existing cut-out; ${pending.length} to cut out with ${MODEL}`);
  if (!pending.length) return;
  const storage = objectStorage();
  const tmp = await mkdtemp(join(tmpdir(), "vehicle-cutout-"));
  try {
    for (let start = 0; start < pending.length; start += BATCH) {
      const batch = pending.slice(start, start + BATCH);
      const input = join(tmp, `in-${start}`), output = join(tmp, `out-${start}`);
      await mkdir(input); await mkdir(output);
      for (const row of batch) {
        const object = await storage.send(new GetObjectCommand({ Bucket: row.bucket, Key: row.object_key }));
        const bytes = await object.Body?.transformToByteArray();
        if (!bytes?.length) throw new Error(`Media ${row.media_id} is empty`);
        await writeFile(join(input, `${row.media_id}.webp`), bytes);
      }
      // One rembg call per batch loads the model once; -dc removes the white fringe left on soft edges.
      await run(REMBG, ["p", "-m", MODEL, "-dc", input, output], { maxBuffer: 64 * 1024 * 1024 });
      const made = new Set(await readdir(output));
      for (const row of batch) {
        if (!made.has(`${row.media_id}.png`)) { console.error(`No cut-out for ${row.media_id}`); continue; }
        const webp = await sharp(join(output, `${row.media_id}.png`)).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
        const { width, height } = await sharp(webp).metadata();
        if (!width || !height) throw new Error(`Cut-out of ${row.media_id} has no dimensions`);
        const file = join(output, `${row.media_id}.webp`);
        await writeFile(file, webp);
        const client = await pool.connect();
        let mediaId: string;
        try { mediaId = await storeProductImage(client, file, `${row.source_url}#cutout=${MODEL}`, storage, "vehicle-types"); } finally { client.release(); }
        await replace(row.media_id, mediaId, width, height);
      }
      await rm(input, { recursive: true }); await rm(output, { recursive: true });
      console.log(`${Math.min(start + BATCH, pending.length)}/${pending.length} cut out`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
    storage.destroy();
  }
}

// Only rows still on the original move, so a picture the collection replaced meanwhile is left for the next run.
const replace = (original: string, cut: string, width: number, height: number) => pool.query(`UPDATE vehicle_type_images
  SET original_media_id=media_id, media_id=$2, width=$3, height=$4 WHERE media_id=$1 AND original_media_id IS NULL`, [original, cut, width, height]);

async function restore() {
  // rembg keeps the picture's size, so width/height stay valid for the original.
  const result = await pool.query(`UPDATE vehicle_type_images SET media_id=original_media_id, original_media_id=NULL
    WHERE original_media_id IS NOT NULL`);
  console.log(`${result.rowCount} vehicle types back on their original picture`);
}

try {
  if (command === "run") await cutout();
  else if (command === "restore") await restore();
  else if (command !== "status") throw new Error(`Unknown command ${command}`);
  await status();
} finally { await pool.end(); }
