import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";

async function bundle(media: { id: string; key: string; size: number }[], manifest: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "storefront-split-"));
  const source = join(root, "full");
  await mkdir(source);
  for (const object of media) {
    await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
    await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
  }
  const rows = media.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size }));
  await writeFile(join(source, "manifest.json"), JSON.stringify({ snapshotAt: "2026-10-26T00:00:00Z", ...manifest, media: rows }));
  return { root, source };
}
const read = async (dir: string) => JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));

test("enrichments are cut into parts by media bytes; part 0 keeps the always-complete data", async () => {
  const { root, source } = await bundle(
    [{ id: "c", key: "cat/c.jpg", size: 10 }, { id: "v", key: "veh/v.jpg", size: 10 }, { id: "a", key: "p/a.jpg", size: 20 }, { id: "d", key: "p/d.jpg", size: 70 }, { id: "b", key: "p/b.jpg", size: 50 }],
    {
      categories: [{ source: "trodo", category_id: 1 }], labels: [{ source: "trodo", category_id: 1, locale: "tr" }],
      images: [{ source: "trodo", category_id: 1, media_id: "c" }], logos: [{ brand_key: "febi" }],
      vehicleSpecs: [{ vehicle_type_id: 7 }], vehicleImages: [{ vehicle_type_id: 7, media_id: "v" }],
      enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: null }, { supplier_item_id: "i3", image_id: "d" },
        { supplier_item_id: "i4", image_id: "b" }, { supplier_item_id: "i5", image_id: "a" }],
      products: [{ supplier_item_id: "i1", category_id: 1 }, { supplier_item_id: "i4", category_id: 1 }],
    });
  try {
    const dirs = await splitStorefrontBundle(source, join(root, "parts"), 100);
    assert.deepEqual(dirs.map(dir => dir.split("/").at(-1)), ["part-00", "part-01", "part-02"]);
    const [first, second, third] = await Promise.all(dirs.map(read));

    assert.deepEqual(first.enrichments, []);
    assert.deepEqual(first.logos, [{ brand_key: "febi" }]);
    assert.deepEqual(first.vehicleSpecs, [{ vehicle_type_id: 7 }]);
    assert.deepEqual(first.media.map((m: { id: string }) => m.id), ["c", "v"]);

    assert.deepEqual(second.enrichments.map((e: { supplier_item_id: string }) => e.supplier_item_id), ["i1", "i2", "i3"]);
    assert.deepEqual(second.products, [{ supplier_item_id: "i1", category_id: 1 }]);
    assert.deepEqual(second.media.map((m: { id: string }) => m.id), ["a", "d"]);
    // A shared image is carried again by the later part that also uses it.
    assert.deepEqual(third.enrichments.map((e: { supplier_item_id: string }) => e.supplier_item_id), ["i4", "i5"]);
    assert.deepEqual(third.products, [{ supplier_item_id: "i4", category_id: 1 }]);
    assert.deepEqual(third.media.map((m: { id: string }) => m.id), ["b", "a"]);
    assert.equal((await stat(join(dirs[2], "media", "p/a.jpg"))).size, 20);

    for (const part of [second, third]) {
      assert.deepEqual(part.categories, [{ source: "trodo", category_id: 1 }]);
      assert.deepEqual([part.images, part.logos, part.vehicleSpecs, part.vehicleImages], [[], [], [], []]);
      assert.equal(part.snapshotAt, "2026-10-26T00:00:00Z");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a bundle without enrichments is a single part", async () => {
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], enrichments: [], products: [] });
  try {
    assert.equal((await splitStorefrontBundle(source, join(root, "parts"), 100)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
