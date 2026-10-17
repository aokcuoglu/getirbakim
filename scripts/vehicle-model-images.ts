import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { storeProductImage } from "../src/modules/enrichment/import";
import { acceptedLicense, classifyMatch, plainAuthor, vehicleModelImageQueries, wikidataBrandName, type ImageMatchKind } from "../src/modules/store/vehicle-model-images";

// Finds a photograph for each TecDoc model series on Wikidata (image, P18) and stores a 480 px WebP copy of the
// Commons file in object storage. Only free licences are taken; the author and licence travel with the row so the
// store can attribute them. Rows start as `pending`; /yonetim/arac-gorselleri (or `approve` here) publishes them.
//
//   npm run vehicles:images -- match [--limit=N] [--brand=RENAULT] [--retry] [--since=2005]
//     (series with an `error` lookup are retried on every run; --retry also reopens `none`)
//   npm run vehicles:images -- status
//   npm run vehicles:images -- approve --kind=generation [--brand=RENAULT]
//
// Wikimedia asks API clients for a descriptive User-Agent and modest, serial request rates (policy: meta.wikimedia.org
// /wiki/User-Agent_policy); requests here are sequential with a short pause.

const USER_AGENT = `getirbakim-vehicle-images/1.0 (${process.env.WIKIMEDIA_CONTACT || "https://getirbakim.com"})`;
const PAUSE_MS = Number(process.env.WIKIMEDIA_PAUSE_MS || 250);
const THUMB_WIDTH = 640, STORE_WIDTH = 480;
const CAR_CLASSES = new Set(["Q3231690", "Q29048322", "Q10929058", "Q1420", "Q752870"]);

type Claims = Record<string, { mainsnak: { datavalue?: { value: unknown } }; rank: string }[]>;
type Entity = { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims?: Claims };
type Candidate = { id: string; label: string; description: string | null; image: string; partOfSeries: boolean; query: string };
type ModelRow = { id: number; brand: string; brand_name: string; name: string; date_from: string | null; date_to: string | null };

const args = process.argv.slice(2);
const command = args.find(arg => !arg.startsWith("--")) ?? "status";
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => args.includes(`--${name}`);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let lastRequest = 0;
const transientNetwork = (error: unknown) => /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|TimeoutError/.test(error instanceof Error ? `${error.name} ${error.message} ${(error.cause as Error | undefined)?.message ?? ""}` : String(error));
async function paced<T>(request: () => Promise<Response>, read: (response: Response) => Promise<T>, what: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now();
    try {
      const response = await request();
      if (response.ok) return read(response);
      if ((response.status === 429 || response.status >= 500) && attempt < 4) { await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); continue; }
      throw new Error(`${response.status} ${what}`);
    } catch (error) {
      // A dropped connection is retried with growing pauses; the caller decides when the network is really gone.
      if (transientNetwork(error) && attempt < 5) { await new Promise(resolve => setTimeout(resolve, 3000 * attempt)); continue; }
      throw error;
    }
  }
}
const fetchJson = <T>(url: string) => paced(() => fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30000) }),
  response => response.json() as Promise<T>, `from ${new URL(url).hostname}`);
const wikidata = (params: Record<string, string>) => `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: "json", ...params })}`;
const commons = (params: Record<string, string>) => `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: "json", ...params })}`;

const claimIds = (claims: Claims | undefined, property: string) => (claims?.[property] ?? []).map(claim => (claim.mainsnak.datavalue?.value as { id?: string } | undefined)?.id).filter((id): id is string => Boolean(id));
function preferredImage(claims: Claims | undefined) {
  const images = (claims?.P18 ?? []).filter(claim => claim.rank !== "deprecated").sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"));
  const value = images[0]?.mainsnak.datavalue?.value;
  return typeof value === "string" ? value : null;
}

// The brand must appear in the label or description: aliases let "Renault Kangoo II" surface the Nissan NV250.
function brandMatches(entity: Entity, brands: string[]) {
  const text = `${entity.labels?.en?.value ?? ""} ${entity.descriptions?.en?.value ?? ""}`.toLocaleLowerCase("en");
  return brands.some(brand => text.includes(brand.toLocaleLowerCase("en")));
}

// Candidates in query order (generation-specific first); the caller takes the first one whose file is usable.
async function* findCandidates(queries: string[], brands: string[]): AsyncGenerator<Candidate> {
  const seen = new Set<string>();
  for (const query of queries) {
    const search = await fetchJson<{ search: { id: string }[] }>(wikidata({ action: "wbsearchentities", search: query, language: "en", type: "item", limit: "4" }));
    const ids = search.search.map(hit => hit.id).filter(id => !seen.has(id));
    for (const id of ids) seen.add(id);
    if (!ids.length) continue;
    const { entities } = await fetchJson<{ entities: Record<string, Entity> }>(wikidata({ action: "wbgetentities", ids: ids.join("|"), props: "labels|descriptions|claims", languages: "en" }));
    for (const id of ids) {
      const entity = entities[id];
      if (!entity?.claims || !brandMatches(entity, brands)) continue;
      const classes = claimIds(entity.claims, "P31");
      if (!claimIds(entity.claims, "P176").length && !classes.some(cls => CAR_CLASSES.has(cls))) continue;
      const image = preferredImage(entity.claims);
      if (!image) continue;
      yield { id, label: entity.labels?.en?.value ?? id, description: entity.descriptions?.en?.value ?? null, image,
        partOfSeries: claimIds(entity.claims, "P179").length > 0, query };
    }
  }
}

type CommonsInfo = { thumburl: string; thumbwidth: number; thumbheight: number; url: string; descriptionurl: string; mime: string; extmetadata?: Record<string, { value: string }> };
async function commonsFile(file: string) {
  const data = await fetchJson<{ query?: { pages?: Record<string, { imageinfo?: CommonsInfo[] }> } }>(commons({ action: "query", titles: `File:${file}`, prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata", iiurlwidth: String(THUMB_WIDTH), iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Attribution|Credit|DateTimeOriginal|Restrictions" }));
  return Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0] ?? null;
}

async function downloadThumb(url: string) {
  const bytes = await paced(() => fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) }),
    async response => Buffer.from(await response.arrayBuffer()), "downloading thumbnail");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Unexpected thumbnail size");
  return bytes;
}

async function recordLookup(client: PoolClient, modelId: number, outcome: "matched" | "none" | "error", detail: string | null, queries: string[]) {
  await client.query(`INSERT INTO vehicle_model_image_lookups(model_id,outcome,detail,queries,attempted_at) VALUES($1,$2,$3,$4,now())
    ON CONFLICT (model_id) DO UPDATE SET outcome=EXCLUDED.outcome,detail=EXCLUDED.detail,queries=EXCLUDED.queries,attempted_at=now()`, [modelId, outcome, detail, queries]);
}

// The photograph must fall inside the series' production window (with slack for facelifts and late photos);
// a family item's picture of an earlier or later generation fails here and the next candidate is tried.
function photoYear(info: CommonsInfo, file: string) {
  const year = info.extmetadata?.DateTimeOriginal?.value?.match(/\b(19|20)\d{2}\b/)?.[0] ?? file.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? Number(year) : null;
}
function outsideWindow(year: number | null, model: ModelRow) {
  if (year === null) return false;
  const from = model.date_from ? Number(model.date_from.slice(0, 4)) : null, to = model.date_to ? Number(model.date_to.slice(0, 4)) : null;
  return (from !== null && year < from - 1) || (to !== null && year > to + 2);
}

async function matchModel(client: PoolClient, model: ModelRow, tmp: string) {
  const plan = vehicleModelImageQueries(model.brand_name, model.name);
  const brands = [...new Set([wikidataBrandName(model.brand_name), wikidataBrandName(model.brand), model.brand_name, model.brand])];
  const rejected: string[] = [];
  for await (const candidate of findCandidates(plan.queries, brands)) {
    const info = await commonsFile(candidate.image);
    const meta = info?.extmetadata ?? {};
    const license = meta.LicenseShortName?.value?.trim() ?? "";
    if (!info || !/^image\/(jpeg|png|webp|tiff)$/.test(info.mime) || !info.thumburl) { rejected.push(`${candidate.label}: unusable file ${candidate.image}`); continue; }
    if (!acceptedLicense(license)) { rejected.push(`${candidate.label}: licence ${license || "unknown"}`); continue; }
    const year = photoYear(info, candidate.image);
    if (outsideWindow(year, model)) { rejected.push(`${candidate.label}: photo from ${year} outside ${model.date_from?.slice(0, 4)}–${model.date_to?.slice(0, 4) ?? "now"}`); continue; }
    const kind: ImageMatchKind = classifyMatch(candidate, plan);
    const original = await downloadThumb(info.thumburl);
    const webp = await sharp(original, { limitInputPixels: 30_000_000 }).rotate().resize({ width: STORE_WIDTH, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const { width, height } = await sharp(webp).metadata();
    if (!width || !height) throw new Error("Converted image has no dimensions");
    const file = join(tmp, `${model.id}.webp`);
    await writeFile(file, webp);
    const mediaId = await storeProductImage(client, file, info.descriptionurl, undefined, "vehicles");
    await rm(file, { force: true });
    await client.query(`INSERT INTO vehicle_model_images(model_id,media_id,width,height,wikidata_id,wikidata_label,commons_file,source_url,license,license_url,author,match_kind,matched_query,status,imported_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',now())
      ON CONFLICT (model_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height,wikidata_id=EXCLUDED.wikidata_id,
        wikidata_label=EXCLUDED.wikidata_label,commons_file=EXCLUDED.commons_file,source_url=EXCLUDED.source_url,license=EXCLUDED.license,license_url=EXCLUDED.license_url,
        author=EXCLUDED.author,match_kind=EXCLUDED.match_kind,matched_query=EXCLUDED.matched_query,status='pending',imported_at=now(),reviewed_at=NULL,reviewed_by=NULL`,
      [model.id, mediaId, width, height, candidate.id, candidate.label, candidate.image, info.descriptionurl, license, meta.LicenseUrl?.value ?? null,
        plainAuthor(meta.Artist?.value ?? meta.Attribution?.value ?? meta.Credit?.value), kind, candidate.query]);
    await recordLookup(client, model.id, "matched", `${candidate.id} ${candidate.label}${rejected.length ? ` (skipped: ${rejected.join("; ")})` : ""}`, plan.queries);
    return kind;
  }
  await recordLookup(client, model.id, "none", rejected.length ? rejected.join("; ") : "no Wikidata item with an image", plan.queries);
  return "none" as const;
}

async function match() {
  const limit = Number(option("limit") || 0), brand = option("brand")?.toLocaleUpperCase("en"), since = Number(option("since") || 0), retry = flag("retry");
  const { rows: models } = await pool.query<ModelRow>(`SELECT m.id, b.name AS brand, b.display_name AS brand_name, m.name, to_char(m.date_from,'YYYY-MM-DD') AS date_from, to_char(m.date_to,'YYYY-MM-DD') AS date_to
    FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE NOT EXISTS (SELECT 1 FROM vehicle_model_images i WHERE i.model_id=m.id)
      AND ($3 OR NOT EXISTS (SELECT 1 FROM vehicle_model_image_lookups l WHERE l.model_id=m.id AND l.outcome<>'error'))
      AND ($1::text IS NULL OR b.name=$1 OR b.display_name=$1)
      AND ($2::int=0 OR m.date_from >= make_date($2,1,1) OR m.date_to IS NULL)
    ORDER BY (m.date_to IS NULL) DESC, m.date_from DESC NULLS LAST, m.id ${limit > 0 ? `LIMIT ${limit}` : ""}`, [brand ?? null, since, retry]);
  console.log(`${models.length} model series to match`);
  const tmp = await mkdtemp(join(tmpdir(), "vehicle-images-"));
  const totals: Record<string, number> = { generation: 0, family: 0, none: 0, error: 0 };
  let stopped = false, networkFailures = 0;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopped = true; console.log("Stopping after the current model…"); });
  try {
    for (const [index, model] of models.entries()) {
      if (stopped) break;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await matchModel(client, model, tmp);
        await client.query("COMMIT");
        totals[result]++;
        networkFailures = 0;
        console.log(`${index + 1}/${models.length} ${model.brand_name} ${model.name} → ${result}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        totals.error++;
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`${index + 1}/${models.length} ${model.brand_name} ${model.name} → error: ${detail}`);
        await pool.query(`INSERT INTO vehicle_model_image_lookups(model_id,outcome,detail,queries) VALUES($1,'error',$2,'{}')
          ON CONFLICT (model_id) DO UPDATE SET outcome='error',detail=EXCLUDED.detail,attempted_at=now()`, [model.id, detail.slice(0, 500)]).catch(() => {});
        // One dropped connection is a retryable `error` row; five series in a row means the network is gone.
        if (transientNetwork(error) && ++networkFailures >= 5) throw new Error(`Network unavailable: ${detail}`);
      } finally { client.release(); }
    }
  } finally { await rm(tmp, { recursive: true, force: true }); }
  console.log(JSON.stringify(totals));
}

async function status() {
  const [images, lookups, coverage] = await Promise.all([
    pool.query("SELECT status, match_kind, count(*)::int AS count FROM vehicle_model_images GROUP BY 1,2 ORDER BY 1,2"),
    pool.query("SELECT outcome, count(*)::int AS count FROM vehicle_model_image_lookups GROUP BY 1 ORDER BY 1"),
    pool.query(`SELECT count(*)::int AS models, count(i.model_id)::int AS with_image, count(i.model_id) FILTER (WHERE i.status='approved')::int AS approved,
      count(l.model_id)::int AS attempted FROM vehicle_models m LEFT JOIN vehicle_model_images i ON i.model_id=m.id LEFT JOIN vehicle_model_image_lookups l ON l.model_id=m.id`),
  ]);
  console.table(images.rows); console.table(lookups.rows); console.table(coverage.rows);
}

async function approve() {
  const kind = option("kind") ?? "generation", brand = option("brand")?.toLocaleUpperCase("en");
  if (!["generation", "family"].includes(kind)) throw new Error("--kind must be generation or family");
  const result = await pool.query(`UPDATE vehicle_model_images i SET status='approved', reviewed_at=now() FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE m.id=i.model_id AND i.status='pending' AND i.match_kind=$1 AND ($2::text IS NULL OR b.name=$2 OR b.display_name=$2)`, [kind, brand ?? null]);
  console.log(`${result.rowCount} ${kind} matches approved`);
}

try {
  if (command === "match") await match();
  else if (command === "status") await status();
  else if (command === "approve") await approve();
  else throw new Error("Expected match, status or approve");
} finally { await pool.end(); }
