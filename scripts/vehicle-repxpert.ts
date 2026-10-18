import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { Pool } from "pg";
import sharp from "sharp";
import { ensureChrome, pageFor, type CdpPage } from "../src/modules/enrichment/chrome-driver";
import { storeProductImage } from "../src/modules/enrichment/import";
import { REPXPERT_ORIGIN, isRepxpertBlock, parseRepxpertVehicle, repxpertVehiclePath } from "../src/modules/store/vehicle-repxpert";

// Reads every TecDoc vehicle type's technical data and side-view picture from REPXPERT into vehicle_type_specs and
// vehicle_type_images. Akamai bot management answers server-side requests with "Access denied", so requests are sent
// from inside a dedicated, ordinary Chrome profile's REPXPERT tab (over DevTools), the way the site's own pages fetch.
// No sign-in is needed for vehicle data. Runs resume: found/missing types are skipped, errors are retried.
//
//   npm run vehicles:repxpert -- collect [--limit=N] [--ids=1,2,3] [--refresh] [--no-images]
//   npm run vehicles:repxpert -- status
//
// REPXPERT_PAUSE_MS (default 700) is the minimum gap between any two requests; a block page stops the run at once.

const PORT = Number(process.env.REPXPERT_CHROME_PORT || 9232);
const PROFILE = resolve(process.env.REPXPERT_CHROME_PROFILE || ".local/repxpert/chrome-profile");
const PAUSE_MS = Number(process.env.REPXPERT_PAUSE_MS || 700);
const HOME = `${REPXPERT_ORIGIN}/tr`;
const STORE_WIDTH = 800;

const args = process.argv.slice(2);
const command = args.find(arg => !arg.startsWith("--")) ?? "status";
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => args.includes(`--${name}`);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Blocked extends Error {}

function notify(message: string) {
  console.error(message);
  if (process.platform === "darwin") execFile("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "getirbakim REPXPERT" sound name "Glass"`], () => {});
}

let lastRequest = 0;
async function paced<T>(page: CdpPage, expression: string): Promise<T> {
  const wait = lastRequest + PAUSE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return page.evaluate<T>(expression, 60000);
}

const fetchJson = (page: CdpPage, path: string) => paced<{ status: number; body: string }>(page,
  `fetch(${JSON.stringify(path)},{headers:{accept:'application/json'}}).then(async r=>({status:r.status,body:await r.text()}))`);
const fetchImage = (page: CdpPage, url: string) => paced<{ status: number; type: string; data: string }>(page,
  `fetch(${JSON.stringify(url)}).then(async r=>{const b=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return{status:r.status,type:r.headers.get('content-type')||'',data:btoa(s)}})`);

async function openPage() {
  await ensureChrome(PORT, PROFILE, HOME);
  const page = await pageFor(PORT, new URL(HOME).hostname, HOME);
  for (let i = 0; i < 60; i++) {
    const state = await page.evaluate<{ host: string; ready: string; title: string }>("({host:location.hostname,ready:document.readyState,title:document.title})", 10000).catch(() => null);
    if (state?.title.includes("Access denied")) throw new Blocked("REPXPERT home page is blocked (Access denied)");
    if (state?.host === new URL(HOME).hostname && state.ready === "complete") return page;
    await sleep(1000);
  }
  throw new Error("REPXPERT page did not load");
}

async function record(id: number, outcome: "found" | "missing" | "error", detail: string | null, specs?: ReturnType<typeof parseRepxpertVehicle>, payload?: unknown) {
  await pool.query(`INSERT INTO vehicle_type_specs(vehicle_type_id,outcome,detail,full_name,body_type,drive_type,engine_type,fuel_mixture,cylinders,valves,engine_codes,kba_numbers,payload,fetched_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
    ON CONFLICT (vehicle_type_id) DO UPDATE SET outcome=EXCLUDED.outcome,detail=EXCLUDED.detail,
      full_name=COALESCE(EXCLUDED.full_name,vehicle_type_specs.full_name),body_type=COALESCE(EXCLUDED.body_type,vehicle_type_specs.body_type),
      drive_type=COALESCE(EXCLUDED.drive_type,vehicle_type_specs.drive_type),engine_type=COALESCE(EXCLUDED.engine_type,vehicle_type_specs.engine_type),
      fuel_mixture=COALESCE(EXCLUDED.fuel_mixture,vehicle_type_specs.fuel_mixture),cylinders=COALESCE(EXCLUDED.cylinders,vehicle_type_specs.cylinders),
      valves=COALESCE(EXCLUDED.valves,vehicle_type_specs.valves),
      engine_codes=CASE WHEN EXCLUDED.payload IS NULL THEN vehicle_type_specs.engine_codes ELSE EXCLUDED.engine_codes END,
      kba_numbers=CASE WHEN EXCLUDED.payload IS NULL THEN vehicle_type_specs.kba_numbers ELSE EXCLUDED.kba_numbers END,
      payload=COALESCE(EXCLUDED.payload,vehicle_type_specs.payload),fetched_at=now()`,
    [id, outcome, detail, specs?.fullName ?? null, specs?.bodyType ?? null, specs?.driveType ?? null, specs?.engineType ?? null, specs?.fuelMixture ?? null,
      specs?.cylinders ?? null, specs?.valves ?? null, specs?.engineCodes ?? [], specs?.kbaNumbers ?? [], payload === undefined ? null : JSON.stringify(payload)]);
}

async function storeImage(page: CdpPage, id: number, url: string, tmp: string) {
  const image = await fetchImage(page, url);
  if (image.status === 403 || image.type.includes("text/html")) throw new Blocked(`Image of TA-${id} is blocked (${image.status})`);
  if (image.status !== 200 || !image.type.startsWith("image/")) throw new Error(`Image ${image.status} ${image.type}`);
  const original = Buffer.from(image.data, "base64");
  const webp = await sharp(original, { limitInputPixels: 30_000_000 }).resize({ width: STORE_WIDTH, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const { width, height } = await sharp(webp).metadata();
  if (!width || !height) throw new Error("Converted image has no dimensions");
  const file = join(tmp, `${id}.webp`);
  await writeFile(file, webp);
  const client = await pool.connect();
  try {
    // REPXPERT image URLs are signed per request, so the source recorded is the vehicle type, not the URL.
    const mediaId = await storeProductImage(client, file, `${REPXPERT_ORIGIN}${repxpertVehiclePath(id)}`, undefined, "vehicle-types");
    await client.query(`INSERT INTO vehicle_type_images(vehicle_type_id,media_id,width,height,imported_at) VALUES($1,$2,$3,$4,now())
      ON CONFLICT (vehicle_type_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height,imported_at=now()`, [id, mediaId, width, height]);
  } finally {
    client.release();
    await rm(file, { force: true });
  }
}

async function collect() {
  const limit = Number(option("limit") || 0), refresh = flag("refresh"), images = !flag("no-images");
  const ids = option("ids")?.split(",").map(Number).filter(Number.isInteger) ?? null;
  const { rows } = await pool.query<{ id: number; image: boolean }>(`SELECT t.id, EXISTS (SELECT 1 FROM vehicle_type_images i WHERE i.vehicle_type_id=t.id) AS image
    FROM vehicle_types t LEFT JOIN vehicle_type_specs s ON s.vehicle_type_id=t.id
    WHERE ($1::int[] IS NULL OR t.id=ANY($1)) AND ($2 OR s.outcome IS NULL OR s.outcome='error' OR ($3 AND s.outcome='found' AND s.payload ? 'imageMap'
      AND NOT EXISTS (SELECT 1 FROM vehicle_type_images i WHERE i.vehicle_type_id=t.id)))
    ORDER BY (s.outcome IS NULL) DESC, t.id ${limit > 0 ? `LIMIT ${limit}` : ""}`, [ids, refresh || ids !== null, images]);
  console.log(JSON.stringify({ event: "start", types: rows.length, pauseMs: PAUSE_MS, images }));
  if (!rows.length) return;
  const page = await openPage();
  const tmp = await mkdtemp(join(tmpdir(), "repxpert-"));
  const totals = { found: 0, missing: 0, error: 0, images: 0, imageErrors: 0 };
  const started = Date.now();
  let consecutiveErrors = 0;
  try {
    for (const [index, row] of rows.entries()) {
      try {
        const response = await fetchJson(page, repxpertVehiclePath(row.id));
        if (isRepxpertBlock(response.status, response.body)) throw new Blocked(`TA-${row.id} blocked (${response.status})`);
        if (response.status === 400 || response.status === 404) {
          await record(row.id, "missing", `${response.status}`);
          totals.missing++;
        } else {
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          const payload = JSON.parse(response.body);
          const specs = parseRepxpertVehicle(payload, row.id);
          await record(row.id, "found", null, specs, payload);
          totals.found++;
          if (images && specs.imageUrl && (refresh || !row.image)) {
            try { await storeImage(page, row.id, specs.imageUrl, tmp); totals.images++; } catch (error) {
              if (error instanceof Blocked) throw error;
              totals.imageErrors++;
              console.log(JSON.stringify({ event: "image_error", id: row.id, error: error instanceof Error ? error.message : String(error) }));
            }
          }
        }
        consecutiveErrors = 0;
      } catch (error) {
        if (error instanceof Blocked) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await record(row.id, "error", message.slice(0, 500));
        totals.error++;
        console.log(JSON.stringify({ event: "error", id: row.id, error: message }));
        // A closed tab or browser fails every remaining type; stop instead of marking them all as errors.
        if (++consecutiveErrors >= 20) throw new Error(`20 consecutive errors, last: ${message}`);
      }
      if ((index + 1) % 100 === 0 || index + 1 === rows.length) {
        const rate = (index + 1) / ((Date.now() - started) / 1000);
        console.log(JSON.stringify({ event: "progress", done: index + 1, of: rows.length, ...totals, perSecond: Number(rate.toFixed(2)),
          etaMinutes: Math.round((rows.length - index - 1) / rate / 60) }));
      }
    }
  } catch (error) {
    if (error instanceof Blocked) notify(`REPXPERT engelledi, koşu durdu: ${error.message}`);
    throw error;
  } finally {
    page.close();
    await rm(tmp, { recursive: true, force: true });
    console.log(JSON.stringify({ event: "end", ...totals }));
  }
}

async function status() {
  const { rows } = await pool.query(`SELECT (SELECT count(*) FROM vehicle_types)::int AS types,
      count(*) FILTER (WHERE s.outcome='found')::int AS found, count(*) FILTER (WHERE s.outcome='missing')::int AS missing,
      count(*) FILTER (WHERE s.outcome='error')::int AS errors,
      (SELECT count(*) FROM vehicle_type_images)::int AS images, (SELECT count(DISTINCT media_id) FROM vehicle_type_images)::int AS distinct_images,
      count(*) FILTER (WHERE cardinality(s.engine_codes)>0)::int AS with_engine_codes, max(s.fetched_at) AS last_fetch
    FROM vehicle_type_specs s`);
  console.table(rows);
}

try {
  if (command === "collect") await collect();
  else if (command === "status") await status();
  else throw new Error(`Unknown command: ${command}`);
} finally {
  await pool.end();
}
