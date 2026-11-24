import { link, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { referencedItemIds, type BundleItem } from "./storefront-bundle-items";
import { readNdjson, readNdjsonRows } from "./storefront-bundle-stream";

type Media = { id: string; object_key: string; size_bytes: number | string };
type Row = Record<string, unknown>;
// The bounded data of the export's manifest.json, which every part copies or blanks.
type Shared = Row & { images: Row[]; logos?: Row[]; tombstones?: Row[]; invalidatedJobs?: number; vehicleImages?: Row[] };
// The export's manifest.json: the rows that grow with the enriched products are in NDJSON files it names and counts
// (export-storefront-bundle.ts).
type Export = Shared & {
  enrichmentsFile?: unknown; enrichmentCount?: unknown; jobsFile?: unknown; jobCount?: unknown; itemsFile?: unknown; itemCount?: unknown;
  productsFile?: unknown; productCount?: unknown; mediaFile?: unknown; mediaCount?: unknown;
};
// A part's manifest.json, the format the released importer reads (import-storefront-bundle.ts).
type Part = Shared & { products: Row[]; enrichments: Row[]; jobs: Row[]; media: Media[]; items?: BundleItem[] };
type SideFile = { file: string; count: number; path: string };
export type SplitLimits = { mediaBytes: number; jsonBytes: number };

// Production's operations task has 4096 MB (2 vCPU) and import-storefront-bundle.ts holds every media
// file of a bundle in memory, so a large export is split into self-contained parts the unchanged importer
// loads one by one, in order:
// - part-00: the always-complete bounded data (category images, logos, REPXPERT vehicle data, tombstones of deleted
//   enrichments and the invalidated job count) with its media, and no jobs;
// - job parts (#1317): every complete/partial enrichment job status, cut before the jobs' JSON plus their supplier item
//   keys would pass limits.jsonBytes. The importer only upserts the jobs a part carries (storefront-bundle-jobs.ts), so
//   spreading them over parts writes the same rows as one part did; they still come after part-00's tombstones;
// - enrichment parts: runs of enrichments with their mappings and images, cut before they would pass limits.mediaBytes
//   of media or limits.jsonBytes of JSON (an enrichment without an image counts too). An enrichment's JSON is its line,
//   its mappings, its media row (once per part) and its supplier item key.
// A row over a limit on its own gets a part of its own; a part opens only when a row arrives, so none is empty. Every
// part after part-00 blanks the always-complete data; tombstones: [] and invalidatedJobs: 0 above all, or the import
// would apply deletions again and count the invalidated jobs once per part. A part's manifest.json is therefore at most
// the empty part (with the small category tree) plus limits.jsonBytes, or plus one row bigger than that, however many
// products are enriched.
// The small category tree goes in every part: each part is dry-run on its own, and its mappings
// reference categories that may be new. An image shared by enrichments in different parts is linked into each
// of them, because an enrichment whose image is missing from its part would be imported without one.
// Enrichments and jobs are read line by line from the export's NDJSON files (#1316, #1317) and each part is written as
// soon as it closes; memory holds the media rows, mappings and supplier item keys of the export (as rows, never one
// string) and one part.
export async function splitStorefrontBundle(source: string, out: string, limits: SplitLimits) {
  const { enrichmentsFile, enrichmentCount, jobsFile, jobCount, itemsFile, itemCount, productsFile, productCount, mediaFile, mediaCount, ...shared }
    = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8")) as Export;
  const side = (file: unknown, count: unknown, fileKey: string, countKey: string): SideFile => {
    if (typeof file !== "string" || typeof count !== "number") {
      throw new Error(`The export's manifest.json names no ${fileKey} and ${countKey}: export it again with this version`);
    }
    const path = resolve(source, file);
    if (!path.startsWith(resolve(source) + sep)) throw new Error(`Unsafe ${fileKey}: ${file}`);
    return { file, count, path };
  };
  const enrichments = side(enrichmentsFile, enrichmentCount, "enrichmentsFile", "enrichmentCount");
  const jobs = side(jobsFile, jobCount, "jobsFile", "jobCount");
  const itemsSide = side(itemsFile, itemCount, "itemsFile", "itemCount");
  const productsSide = side(productsFile, productCount, "productsFile", "productCount");
  const mediaSide = side(mediaFile, mediaCount, "mediaFile", "mediaCount");
  const counted = ({ file, count }: SideFile, read: number, what: string) => {
    if (read !== count) throw new Error(`${file} has ${read} ${what}, the manifest says ${count}`);
  };
  const rows = async <T>(sideFile: SideFile, what: string) => {
    const list = await readNdjsonRows<T>(sideFile.path);
    counted(sideFile, list.length, what);
    return list;
  };

  const media = new Map((await rows<Media>(mediaSide, "media rows")).map(object => [object.id, object]));
  const pick = (ids: Iterable<unknown>) => [...new Set(ids)].filter(id => id != null).map(id => {
    const object = media.get(id as string);
    if (!object) throw new Error(`Bundle references missing media ${id}`);
    return object;
  });
  // The category mappings of each supplier item, moved into the part that carries its enrichment.
  const mappings = new Map<unknown, Row[]>();
  for (const product of await rows<Row>(productsSide, "product mappings")) {
    const list = mappings.get(product.supplier_item_id);
    if (list) list.push(product);
    else mappings.set(product.supplier_item_id, [product]);
  }
  // Each part carries the supplier item keys its own rows reference.
  const items = new Map((await rows<BundleItem>(itemsSide, "supplier item keys")).map(item => [item.id, item]));
  // A row's bytes in a part's manifest.json: its JSON and the comma after it.
  const jsonSize = (row: unknown) => Buffer.byteLength(JSON.stringify(row)) + 1;
  const itemSize = (id: unknown) => {
    const item = items.get(id as string);
    return item ? jsonSize(item) : 0;
  };

  const dirs: string[] = [];
  const flush = async (part: Part) => {
    const dir = resolve(out, `part-${String(dirs.length).padStart(2, "0")}`);
    await mkdir(dir, { recursive: true });
    for (const object of part.media) {
      const from = resolve(source, "media", object.object_key);
      const to = resolve(dir, "media", object.object_key);
      if (!from.startsWith(resolve(source, "media") + sep) || !to.startsWith(resolve(dir, "media") + sep)) throw new Error("Unsafe media key");
      await mkdir(dirname(to), { recursive: true });
      await link(from, to);
    }
    part.items = referencedItemIds(part).flatMap(id => items.get(id) ?? []);
    await writeFile(resolve(dir, "manifest.json"), JSON.stringify(part));
    dirs.push(dir);
  };
  const emptyPart = (): Part => ({
    ...shared, images: [], logos: [], jobs: [], tombstones: [], invalidatedJobs: 0, vehicleSpecs: [], vehicleImages: [], products: [], enrichments: [], media: [],
  });
  await flush({
    ...shared, products: [], enrichments: [], jobs: [],
    media: pick([...shared.images.map(row => row.media_id), ...(shared.vehicleImages ?? []).map(row => row.media_id)]),
  });

  let jobPart: Part | null = null;
  let jobBytes = 0;
  let jobsRead = 0;
  for await (const { row: job, bytes } of readNdjson(jobs.path)) {
    const unit = bytes + itemSize(job.supplier_item_id);
    if (!jobPart || jobBytes + unit > limits.jsonBytes) {
      if (jobPart) await flush(jobPart);
      jobPart = emptyPart();
      jobBytes = 0;
    }
    jobPart.jobs.push(job);
    jobBytes += unit;
    jobsRead++;
  }
  if (jobPart) await flush(jobPart);
  counted(jobs, jobsRead, "jobs");

  let part: Part | null = null;
  let mediaBytes = 0;
  let jsonBytes = 0;
  let linked = new Set<string>();
  let enrichmentsRead = 0;
  const sizeIn = (image: string | null) => image && !linked.has(image) ? Number(pick([image])[0].size_bytes) : 0;
  const rowIn = (image: string | null) => image && !linked.has(image) ? jsonSize(pick([image])[0]) : 0;
  for await (const { row: enrichment, bytes } of readNdjson(enrichments.path)) {
    const image = enrichment.image_id as string | null;
    const own = mappings.get(enrichment.supplier_item_id);
    // Everything but the media row, which only the first enrichment of a part that links the image adds.
    const fixed = bytes + (own ?? []).reduce((sum, row) => sum + jsonSize(row), 0) + itemSize(enrichment.supplier_item_id);
    if (!part || (part.enrichments.length && (mediaBytes + sizeIn(image) > limits.mediaBytes || jsonBytes + fixed + rowIn(image) > limits.jsonBytes))) {
      if (part) await flush(part);
      part = emptyPart();
      mediaBytes = 0;
      jsonBytes = 0;
      linked = new Set();
    }
    part.enrichments.push(enrichment);
    jsonBytes += fixed + rowIn(image);
    enrichmentsRead++;
    if (own) {
      part.products.push(...own);
      mappings.delete(enrichment.supplier_item_id);
    }
    if (image && !linked.has(image)) {
      mediaBytes += sizeIn(image);
      linked.add(image);
      part.media.push(media.get(image)!);
    }
  }
  if (part) await flush(part);
  if (mappings.size) throw new Error(`Product mapping without enrichment: ${[...mappings.keys()][0]}`);
  counted(enrichments, enrichmentsRead, "enrichments");
  return dirs;
}
