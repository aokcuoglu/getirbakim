import { link, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

type Media = { id: string; object_key: string; size_bytes: number | string };
type Row = Record<string, unknown>;
type Manifest = Row & {
  images: Row[]; products: Row[]; enrichments: Row[]; vehicleImages?: Row[]; media: Media[];
};

// Production's operations container is limited to 512 MB and import-storefront-bundle.ts holds every media
// file of a bundle in memory, so a large export is split into self-contained parts the unchanged importer
// loads one by one. Part 0 carries the always-complete data (category images, logos, REPXPERT vehicle data) with
// its media; every later part carries a run of enrichments with their mappings and images, cut at maxBytes
// of media. The small category tree goes in every part: each part is dry-run on its own, and its mappings
// reference categories that may be new. An image shared by enrichments in different parts is linked into each
// of them, because an enrichment whose image is missing from its part would be imported without one.
export async function splitStorefrontBundle(source: string, out: string, maxBytes: number) {
  const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8")) as Manifest;
  const media = new Map(manifest.media.map(object => [object.id, object]));
  const pick = (ids: Iterable<unknown>) => [...new Set(ids)].filter(id => id != null).map(id => {
    const object = media.get(id as string);
    if (!object) throw new Error(`Bundle references missing media ${id}`);
    return object;
  });
  const parts: Manifest[] = [{
    ...manifest, products: [], enrichments: [],
    media: pick([...manifest.images.map(row => row.media_id), ...(manifest.vehicleImages ?? []).map(row => row.media_id)]),
  }];
  const startPart = () => parts.push({ ...manifest, images: [], logos: [], vehicleSpecs: [], vehicleImages: [], products: [], enrichments: [], media: [] });
  let bytes = 0;
  let ids = new Set<string>();
  const sizeIn = (image: string | null) => image && !ids.has(image) ? Number(pick([image])[0].size_bytes) : 0;
  for (const enrichment of manifest.enrichments) {
    const image = enrichment.image_id as string | null;
    if (parts.length === 1 || (bytes + sizeIn(image) > maxBytes && parts.at(-1)!.enrichments.length)) {
      startPart();
      bytes = 0;
      ids = new Set();
    }
    const part = parts.at(-1)!;
    part.enrichments.push(enrichment);
    if (image && !ids.has(image)) {
      bytes += sizeIn(image);
      ids.add(image);
      part.media.push(media.get(image)!);
    }
  }
  const owner = new Map<unknown, Manifest>(parts.flatMap(part => part.enrichments.map(row => [row.supplier_item_id, part] as const)));
  for (const product of manifest.products) {
    const part = owner.get(product.supplier_item_id);
    if (!part) throw new Error(`Product mapping without enrichment: ${product.supplier_item_id}`);
    part.products.push(product);
  }

  const dirs: string[] = [];
  for (const [index, part] of parts.entries()) {
    const dir = resolve(out, `part-${String(index).padStart(2, "0")}`);
    await mkdir(dir, { recursive: true });
    for (const object of part.media) {
      const from = resolve(source, "media", object.object_key);
      const to = resolve(dir, "media", object.object_key);
      if (!from.startsWith(resolve(source, "media") + sep) || !to.startsWith(resolve(dir, "media") + sep)) throw new Error("Unsafe media key");
      await mkdir(dirname(to), { recursive: true });
      await link(from, to);
    }
    await writeFile(resolve(dir, "manifest.json"), JSON.stringify(part));
    dirs.push(dir);
  }
  return dirs;
}
