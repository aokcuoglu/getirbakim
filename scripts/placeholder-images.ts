// Source placeholder images stored as product photos (#1098). Workflow:
//   1. candidates   list automatic images shared by many manufacturer part numbers and write contact sheets to look at
//   2. review       a person looks at every sheet; only placeholders (no product in the picture) are listed, by sha256,
//                   in src/modules/enrichment/placeholder-images.ts and committed. Real family photos stay off the list.
//   3. clean        once the list is merged, `clean --apply` drops the listed images from existing enrichments here
//   4. sync         `npm run storefront:sync` carries the cleared images to production (imported_at moves forward)
//
//   candidates [--min-parts=5] [--out=artifacts/placeholder-images]   candidates.json, index.html, sheet-NN.png
//   report [--sha256-file=FILE]   JSON: what the listed images still touch. FILE (one sha256 per line) replaces the
//                                 committed list, to weigh a proposed entry before it is listed.
//   clean [--apply]               dry run counts; --apply runs clearPlaceholderImages (src/modules/enrichment/placeholder-clean.ts)
//                                 in one transaction: image_id=NULL, payload image dimensions removed, imported_at=now()
//                                 on the enrichments that use a listed image, and their complete jobs turn partial (image
//                                 fill retries them). Then the shared-link and state queues are drained. Idempotent: a
//                                 second run finds nothing. The storefront sync carries both: the enrichment by its newer
//                                 imported_at, the job status because the bundle sends every complete/partial job.
//                                 Side effect: the newer imported_at makes the cleaned row the newest donor in
//                                 product_enrichment_shared_compute, but its status now ranks it (partial) below a
//                                 complete sibling of the same product, so a sibling with its own photo still wins.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import sharp from "sharp";
import { objectStorage } from "../src/lib/object-storage";
import { clearPlaceholderImages, placeholderImageUse } from "../src/modules/enrichment/placeholder-clean";
import { placeholderImageSha256 } from "../src/modules/enrichment/placeholder-images";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { drainSharedLinks, syncEnrichmentStates } from "./enrichment-derived-sync";
import { sendWithSkewRetry } from "./storefront-media-read";

const [command = "report", ...args] = process.argv.slice(2);
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

type Candidate = {
  index: number; imageId: string; sha256: string; parts: number; donorRows: number; storefrontRows: number;
  manufacturers: string[]; samples: { part: string; name: string | null }[]; sourceUrl: string; host: string;
  bucket: string; objectKey: string; listed: boolean;
};

async function candidates() {
  const minParts = Number(option("min-parts") ?? 5);
  if (!Number.isInteger(minParts) || minParts < 2) throw new Error("--min-parts must be an integer >= 2");
  const out = resolve(option("out") ?? "artifacts/placeholder-images");
  const rows = (await pool.query<Omit<Candidate, "index" | "listed" | "host">>(
    `WITH shared AS (
       SELECT image_id, count(DISTINCT manufacturer_part_number)::int AS parts, count(*)::int AS donor_rows
       FROM product_enrichments WHERE image_id IS NOT NULL
       GROUP BY image_id HAVING count(DISTINCT manufacturer_part_number) >= $1)
     SELECT m.id::text AS "imageId", m.sha256, sh.parts, sh.donor_rows AS "donorRows",
       (SELECT count(*)::int FROM product_enrichment_shared_links l WHERE l.image_id=m.id) AS "storefrontRows",
       (SELECT array_agg(DISTINCT e.manufacturer ORDER BY e.manufacturer) FROM product_enrichments e WHERE e.image_id=m.id) AS manufacturers,
       (SELECT coalesce(json_agg(json_build_object('part', x.part, 'name', x.name)), '[]') FROM (
          SELECT DISTINCT ON (e.manufacturer_part_number) e.manufacturer_part_number AS part, supplier_item_name(s.supplier, s.product_data) AS name
          FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
          WHERE e.image_id=m.id ORDER BY e.manufacturer_part_number LIMIT 3) x) AS samples,
       m.source_url AS "sourceUrl", m.bucket, m.object_key AS "objectKey"
     FROM shared sh JOIN product_media_objects m ON m.id=sh.image_id
     ORDER BY sh.parts DESC, m.sha256`, [minParts])).rows;
  const list: Candidate[] = rows.map((row, index) => ({
    ...row, index: index + 1, host: hostOf(row.sourceUrl), listed: placeholderImageSha256.has(row.sha256),
  }));
  await mkdir(out, { recursive: true });
  const storage = objectStorage();
  const tiles: { candidate: Candidate; image: Buffer | null }[] = [];
  for (const candidate of list) {
    const result = await sendWithSkewRetry(() => storage.send(new GetObjectCommand({ Bucket: candidate.bucket, Key: candidate.objectKey })),
      { onRetry: (attempt, delayMs) => console.warn(`Clock skew reading ${candidate.objectKey}; retry ${attempt} in ${delayMs / 1000}s`) });
    const bytes = await result.Body?.transformToByteArray();
    if (bytes && createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) throw new Error(`Media integrity failed: ${candidate.objectKey}`);
    tiles.push({ candidate, image: bytes ? Buffer.from(bytes) : null });
  }
  const sheets: string[] = [];
  for (let start = 0; start < tiles.length; start += SHEET_TILES) {
    const name = `sheet-${String(sheets.length + 1).padStart(2, "0")}.png`;
    await writeFile(resolve(out, name), await contactSheet(tiles.slice(start, start + SHEET_TILES)));
    sheets.push(name);
  }
  await writeFile(resolve(out, "candidates.json"), JSON.stringify({ minParts, generatedAt: new Date().toISOString(), candidates: list }, null, 2));
  await writeFile(resolve(out, "index.html"), indexHtml(list, sheets));
  console.log(JSON.stringify({ minParts, candidates: list.length, listed: list.filter(item => item.listed).length,
    storefrontRows: list.reduce((sum, item) => sum + item.storefrontRows, 0), sheets: sheets.length, out }));
}

async function denylist() {
  const file = option("sha256-file");
  if (!file) return [...placeholderImageSha256];
  const list = (await readFile(resolve(file), "utf8")).split(/\s+/).filter(Boolean);
  const invalid = list.find(sha256 => !/^[a-f0-9]{64}$/.test(sha256));
  if (invalid) throw new Error(`Not a sha256: ${invalid}`);
  return [...new Set(list)];
}

// What the listed images reach: donor enrichments by job status, and present storefront rows (shared links), split by
// source host. "uploaded" rows already show an admin upload; the rest show PartArt once the image is hidden.
async function report() {
  const list = await denylist();
  const { rows } = await pool.query<{ host: string; images: number; donors: Record<string, number> | null; storefront: number; uploaded: number }>(
    `WITH listed AS (SELECT id, split_part(source_url,'/',3) AS host FROM product_media_objects WHERE sha256=ANY($1::text[])),
     donors AS (SELECT l.host, coalesce(j.status,'none') AS status, count(*)::int AS n FROM product_enrichments e JOIN listed l ON l.id=e.image_id
       LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=e.supplier_item_id GROUP BY 1,2),
     store AS (SELECT l.host, count(*)::int AS storefront,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM product_sources ps JOIN product_override_images o ON o.product_id=ps.product_id
         WHERE ps.supplier_item_id=sl.supplier_item_id))::int AS uploaded
       FROM product_enrichment_shared_links sl JOIN listed l ON l.id=sl.image_id JOIN supplier_items s ON s.id=sl.supplier_item_id
       WHERE s.presence='present' AND s.company=ANY($2::text[]) GROUP BY 1)
     SELECT l.host, count(*)::int AS images,
       (SELECT jsonb_object_agg(d.status, d.n) FROM donors d WHERE d.host=l.host) AS donors,
       coalesce((SELECT storefront FROM store WHERE store.host=l.host),0) AS storefront,
       coalesce((SELECT uploaded FROM store WHERE store.host=l.host),0) AS uploaded
     FROM listed l GROUP BY l.host ORDER BY l.host`, [list, storefrontCompanies()]);
  const sum = (key: "images" | "storefront" | "uploaded") => rows.reduce((total, row) => total + row[key], 0);
  const donors: Record<string, number> = {};
  for (const row of rows) for (const [status, n] of Object.entries(row.donors ?? {})) donors[status] = (donors[status] ?? 0) + n;
  console.log(JSON.stringify({ listed: list.length, found: sum("images"), donors, storefront: sum("storefront"), uploaded: sum("uploaded"),
    byHost: Object.fromEntries(rows.map(row => [row.host, { images: row.images, donors: row.donors ?? {}, storefront: row.storefront, uploaded: row.uploaded }])) }, null, 2));
}

async function clean() {
  const list = [...placeholderImageSha256], apply = args.includes("--apply");
  if (!list.length) throw new Error("The placeholder list is empty; nothing to clean.");
  if (!apply) { console.log(JSON.stringify({ dryRun: true, listed: list.length, ...await placeholderImageUse(pool, list) })); return; }
  const client = await pool.connect();
  let result: Awaited<ReturnType<typeof clearPlaceholderImages>>;
  try {
    await client.query("BEGIN");
    result = await clearPlaceholderImages(client, list);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const derived = await drainSharedLinks(pool);
  const states = await syncEnrichmentStates(pool);
  console.log(JSON.stringify({ listed: list.length, ...result, ...derived, states }));
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

const SHEET_TILES = 24, COLUMNS = 6, TILE = 240, LABEL = 44, GAP = 8;
const escapeXml = (text: string) => text.replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`);

async function contactSheet(tiles: { candidate: Candidate; image: Buffer | null }[]) {
  const rows = Math.ceil(tiles.length / COLUMNS);
  const width = COLUMNS * (TILE + GAP) + GAP, height = rows * (TILE + LABEL + GAP) + GAP;
  const layers: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [];
  for (const [position, { candidate, image }] of tiles.entries()) {
    const left = GAP + (position % COLUMNS) * (TILE + GAP), top = GAP + Math.floor(position / COLUMNS) * (TILE + LABEL + GAP);
    if (image) {
      const input = await sharp(image).flatten({ background: "#ffffff" })
        .resize(TILE, TILE, { fit: "contain", background: "#ffffff" }).png().toBuffer().catch(() => null);
      if (input) layers.push({ input, left, top });
    }
    const label = `<svg width="${TILE}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#222"/>`
      + `<text x="6" y="18" font-family="Helvetica" font-size="16" font-weight="bold" fill="#fff">#${candidate.index} · ${candidate.parts} parça${candidate.listed ? " · LISTED" : ""}</text>`
      + `<text x="6" y="37" font-family="Helvetica" font-size="12" fill="#ccc">${escapeXml(`${candidate.host} · ${candidate.manufacturers.slice(0, 2).join(", ")}`.slice(0, 38))}</text></svg>`;
    layers.push({ input: Buffer.from(label), left, top: top + TILE });
  }
  return sharp({ create: { width, height, channels: 3, background: "#888888" } }).composite(layers).png().toBuffer();
}

function indexHtml(list: Candidate[], sheets: string[]) {
  const rows = list.map(item => `<tr><td>${item.index}</td><td>${item.parts}</td><td>${item.storefrontRows}</td><td>${escapeXml(item.host)}</td>`
    + `<td>${escapeXml(item.manufacturers.join(", "))}</td><td>${escapeXml(item.samples.map(sample => `${sample.part} ${sample.name ?? ""}`).join(" | "))}</td>`
    + `<td><code>${item.sha256}</code></td><td>${item.listed ? "listed" : ""}</td></tr>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Placeholder candidates</title>
${sheets.map(sheet => `<p><img src="${sheet}" alt="${sheet}"></p>`).join("\n")}
<table border="1" cellpadding="4"><tr><th>#</th><th>parts</th><th>storefront</th><th>host</th><th>manufacturers</th><th>samples</th><th>sha256</th><th></th></tr>
${rows}</table>`;
}

try {
  if (command === "candidates") await candidates();
  else if (command === "report") await report();
  else if (command === "clean") await clean();
  else throw new Error(`Unknown command: ${command}`);
} finally { await pool.end(); }
