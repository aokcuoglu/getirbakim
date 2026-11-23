import { link, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { referencedItemIds, type BundleItem } from "./storefront-bundle-items";
import { readNdjson } from "./storefront-bundle-stream";

type Media = { id: string; object_key: string; size_bytes: number | string };
type Row = Record<string, unknown>;
type Shared = Row & {
  images: Row[]; products: Row[]; logos?: Row[]; jobs?: Row[]; tombstones?: Row[]; invalidatedJobs?: number; vehicleImages?: Row[]; media: Media[]; items?: BundleItem[];
};
// The export's manifest.json: everything but the enrichments, which are in its enrichmentsFile (export-storefront-bundle.ts).
type Export = Shared & { enrichmentsFile?: unknown; enrichmentCount?: unknown };
// A part's manifest.json, the format the released importer reads (import-storefront-bundle.ts).
type Part = Shared & { enrichments: Row[] };
export type SplitLimits = { mediaBytes: number; jsonBytes: number };

// Production's operations task has 4096 MB (2 vCPU) and import-storefront-bundle.ts holds every media
// file of a bundle in memory, so a large export is split into self-contained parts the unchanged importer
// loads one by one. Part 0 carries the always-complete data (category images, logos, REPXPERT vehicle data,
// enrichment job statuses, tombstones of deleted enrichments and the invalidated job count) with
// its media; every later part carries a run of enrichments with their mappings and images, cut before it would pass
// limits.mediaBytes of media or limits.jsonBytes of enrichment JSON (an enrichment without an image counts too). Only
// the enrichment lines count towards jsonBytes; their mappings (~0.5% of them) and the category tree are left out.
// An enrichment over a limit on its own gets a part of its own; a part opens only when an enrichment arrives, so none is empty.
// The small category tree goes in every part: each part is dry-run on its own, and its mappings
// reference categories that may be new. An image shared by enrichments in different parts is linked into each
// of them, because an enrichment whose image is missing from its part would be imported without one.
// The enrichments are read line by line from the export's enrichments.ndjson (#1316) and each part is written as soon
// as it closes, so memory holds the export's manifest and one part, never every enrichment.
export async function splitStorefrontBundle(source: string, out: string, limits: SplitLimits) {
  const { enrichmentsFile, enrichmentCount, ...shared } = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8")) as Export;
  if (typeof enrichmentsFile !== "string" || typeof enrichmentCount !== "number") {
    throw new Error("The export's manifest.json names no enrichmentsFile and enrichmentCount: export it again with this version");
  }
  const enrichmentsPath = resolve(source, enrichmentsFile);
  if (!enrichmentsPath.startsWith(resolve(source) + sep)) throw new Error("Unsafe enrichments file");
  const media = new Map(shared.media.map(object => [object.id, object]));
  const pick = (ids: Iterable<unknown>) => [...new Set(ids)].filter(id => id != null).map(id => {
    const object = media.get(id as string);
    if (!object) throw new Error(`Bundle references missing media ${id}`);
    return object;
  });
  // The category mappings of each supplier item, moved into the part that carries its enrichment.
  const mappings = new Map<unknown, Row[]>();
  for (const product of shared.products) {
    const rows = mappings.get(product.supplier_item_id);
    if (rows) rows.push(product);
    else mappings.set(product.supplier_item_id, [product]);
  }
  // Each part carries the supplier item keys its own rows reference (older bundles have none).
  const items = shared.items ? new Map(shared.items.map(item => [item.id, item])) : null;

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
    if (items) part.items = referencedItemIds(part).flatMap(id => items.get(id) ?? []);
    await writeFile(resolve(dir, "manifest.json"), JSON.stringify(part));
    dirs.push(dir);
  };
  await flush({
    ...shared, products: [], enrichments: [],
    media: pick([...shared.images.map(row => row.media_id), ...(shared.vehicleImages ?? []).map(row => row.media_id)]),
  });

  let part: Part | null = null;
  let mediaBytes = 0;
  let jsonBytes = 0;
  let linked = new Set<string>();
  let count = 0;
  const sizeIn = (image: string | null) => image && !linked.has(image) ? Number(pick([image])[0].size_bytes) : 0;
  for await (const { row: enrichment, bytes } of readNdjson(enrichmentsPath)) {
    const image = enrichment.image_id as string | null;
    if (!part || (part.enrichments.length && (mediaBytes + sizeIn(image) > limits.mediaBytes || jsonBytes + bytes > limits.jsonBytes))) {
      if (part) await flush(part);
      part = { ...shared, images: [], logos: [], jobs: [], tombstones: [], invalidatedJobs: 0, vehicleSpecs: [], vehicleImages: [], products: [], enrichments: [], media: [] };
      mediaBytes = 0;
      jsonBytes = 0;
      linked = new Set();
    }
    part.enrichments.push(enrichment);
    jsonBytes += bytes;
    count++;
    const rows = mappings.get(enrichment.supplier_item_id);
    if (rows) {
      part.products.push(...rows);
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
  if (count !== enrichmentCount) throw new Error(`${enrichmentsFile} has ${count} enrichments, the manifest says ${enrichmentCount}`);
  return dirs;
}
