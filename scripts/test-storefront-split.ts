import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { ENRICHMENTS_FILE, ndjsonWriter, readNdjson } from "./storefront-bundle-stream";

type Row = Record<string, unknown>;

// An export directory as export-storefront-bundle.ts writes it (#1316): manifest.enrichments goes to enrichments.ndjson,
// the manifest names the file and the row count.
async function bundle(media: { id: string; key: string; size: number }[], { enrichments = [], ...manifest }: Row & { enrichments?: Row[] }) {
  const root = await mkdtemp(join(tmpdir(), "storefront-split-"));
  const source = join(root, "full");
  await mkdir(source);
  for (const object of media) {
    await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
    await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
  }
  const writer = ndjsonWriter(join(source, ENRICHMENTS_FILE));
  for (const row of enrichments) await writer.write(row);
  await writer.close();
  const rows = media.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size }));
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    snapshotAt: "2026-10-26T00:00:00Z", ...manifest, enrichmentsFile: ENRICHMENTS_FILE, enrichmentCount: enrichments.length, media: rows,
  }));
  return { root, source };
}
const read = async (dir: string) => JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
const split = async (source: string, out: string, limits: { mediaBytes: number; jsonBytes: number }) => Promise.all((await splitStorefrontBundle(source, out, limits)).map(read));
// Cut by media bytes only, as before #1316.
const MEDIA = { mediaBytes: 100, jsonBytes: 1e9 };
const lineBytes = (row: Row) => Buffer.byteLength(JSON.stringify(row)) + 1;
const ids = (part: { enrichments: { supplier_item_id: string }[] }) => part.enrichments.map(row => row.supplier_item_id);

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
    const dirs = await splitStorefrontBundle(source, join(root, "parts"), MEDIA);
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

test("each part carries the supplier item keys its own rows reference", async () => {
  const key = (id: string) => ({ id, supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: `CODE ${id}` });
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], {
    categories: [], labels: [], images: [], logos: [{ brand_key: "febi", evidence_product_id: "i9" }],
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }],
    products: [{ supplier_item_id: "i2", category_id: 1 }],
    items: [key("i1"), key("i2"), key("i9")],
  });
  try {
    const parts = await Promise.all((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).map(read));
    assert.deepEqual(parts.map(part => part.items.map((item: { id: string }) => item.id)), [["i9"], ["i1"], ["i2"]]);
    assert.deepEqual(parts[2].items[0], key("i2"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a bundle written before supplier item keys keeps no items", async () => {
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], enrichments: [{ supplier_item_id: "i1", image_id: null }], products: [] });
  try {
    const parts = await Promise.all((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).map(read));
    assert.ok(parts.every(part => !("items" in part)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a bundle without enrichments is a single part", async () => {
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], enrichments: [], products: [] });
  try {
    assert.equal((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("enrichment job statuses go whole in part 0 with their supplier item keys", async () => {
  const key = (id: string) => ({ id, supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: `CODE ${id}` });
  const jobs = [{ supplier_item_id: "i1", status: "complete" }, { supplier_item_id: "i8", status: "partial" }];
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], {
    categories: [], labels: [], images: [], logos: [], jobs,
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }], products: [],
    items: [key("i1"), key("i2"), key("i8")],
  });
  try {
    const parts = await Promise.all((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).map(read));
    assert.equal(parts.length, 3);
    assert.deepEqual(parts[0].jobs, jobs);
    assert.deepEqual(parts.slice(1).map(part => part.jobs), [[], []]);
    assert.deepEqual(parts[0].items, [key("i1"), key("i8")]);
    assert.deepEqual(parts.map(part => part.items.map((item: { id: string }) => item.id)), [["i1", "i8"], ["i1"], ["i2"]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tombstones and the invalidated job count go whole in part 0; later parts carry none", async () => {
  const key = (id: string) => ({ id, supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: `CODE ${id}` });
  const tombstones = [{ supplier_item_id: "i7", kind: "enrichment_deleted" }, { supplier_item_id: "i8", kind: "job_invalidated" }];
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], {
    categories: [], labels: [], images: [], logos: [], tombstones, invalidatedJobs: 3, maxDeletions: 25,
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }], products: [],
    items: [key("i1"), key("i2"), key("i7"), key("i8")],
  });
  try {
    const parts = await Promise.all((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).map(read));
    assert.equal(parts.length, 3);
    assert.deepEqual(parts[0].tombstones, tombstones);
    assert.deepEqual(parts.slice(1).map(part => part.tombstones), [[], []]);
    assert.deepEqual(parts.map(part => part.items.map((item: { id: string }) => item.id)), [["i7", "i8"], ["i1"], ["i2"]]);
    assert.deepEqual(parts.map(part => part.maxDeletions), [25, 25, 25]);
    // Counted once: the inbound report sums every part.
    assert.deepEqual(parts.map(part => part.invalidatedJobs), [3, 0, 0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("image-less enrichments are cut by JSON bytes: a delta past the string limit splits into parts under the cap", async () => {
  const enrichments = ["i1", "i2", "i3", "i4", "i5"].map(id => ({ supplier_item_id: id, image_id: null, payload: { vehicles: "x".repeat(40) } }));
  const { root, source } = await bundle([], {
    categories: [{ source: "trodo", category_id: 1 }], labels: [], images: [], logos: [], enrichments,
    products: [{ supplier_item_id: "i3", category_id: 1 }, { supplier_item_id: "i5", category_id: 1 }, { supplier_item_id: "i5", category_id: 2 }],
  });
  try {
    const parts = await split(source, join(root, "parts"), { mediaBytes: 100, jsonBytes: lineBytes(enrichments[0]) * 2 });
    assert.deepEqual(parts.map(ids), [[], ["i1", "i2"], ["i3", "i4"], ["i5"]]);
    assert.equal(parts.reduce((sum, part) => sum + part.enrichments.length, 0), 5);
    assert.deepEqual(parts.map(part => part.products.length), [0, 0, 1, 2]);
    for (const part of parts.slice(1)) assert.deepEqual(part.categories, [{ source: "trodo", category_id: 1 }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an enrichment larger than the JSON cap gets a part of its own; no part is empty", async () => {
  const small = (id: string) => ({ supplier_item_id: id, image_id: null, payload: {} });
  const huge = { supplier_item_id: "i2", image_id: null, payload: { vehicles: "v".repeat(5000) } };
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], products: [], enrichments: [small("i1"), huge, small("i3")] });
  try {
    const parts = await split(source, join(root, "parts"), { mediaBytes: 100, jsonBytes: lineBytes(small("i1")) * 3 });
    assert.deepEqual(parts.map(ids), [[], ["i1"], ["i2"], ["i3"]]);
    assert.deepEqual(parts[2].enrichments[0], huge);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("enrichment text survives the line format: U+2028/U+2029, escaped newlines, multi-byte text across read chunks", async () => {
  const enrichment = {
    supplier_item_id: "i1", image_id: null, imported_at: "2026-11-23T01:30:00.000Z",
    payload: { name: "Fren balatası\u2028ön\u2029arka", note: "line 1\nline 2\r\n", vehicles: "Şğ€".repeat(60_000) },
  };
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], products: [], enrichments: [enrichment, { supplier_item_id: "i2", image_id: null }] });
  try {
    // JSON.stringify leaves U+2028 as it is: a reader splitting on it (node:readline) would cut this line.
    assert.ok((await readFile(join(source, ENRICHMENTS_FILE), "utf8")).includes("\u2028"));
    const lines: { row: Row; bytes: number }[] = [];
    for await (const line of readNdjson(join(source, ENRICHMENTS_FILE))) lines.push(line);
    assert.deepEqual(lines.map(line => line.row), [enrichment, { supplier_item_id: "i2", image_id: null }]);
    assert.deepEqual(lines.map(line => line.bytes), [lineBytes(enrichment), lineBytes({ supplier_item_id: "i2", image_id: null })]);
    const parts = await split(source, join(root, "parts"), MEDIA);
    assert.deepEqual(parts[1].enrichments[0], enrichment);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("every part has exactly the keys of the format the released importer reads", async () => {
  const key = (id: string) => ({ id, supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: `CODE ${id}` });
  const legacy = {
    exportedAt: "2026-11-23T01:30:00Z", since: "2026-11-22T00:30:03.779Z", retried: 0, snapshotAt: "2026-11-23T01:29:00Z",
    categories: [], labels: [], images: [], products: [{ supplier_item_id: "i2", category_id: 1 }],
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }],
    logos: [], vehicleSpecs: [], vehicleImages: [], jobs: [], tombstones: [], invalidatedJobs: 0, maxDeletions: 1000, items: [key("i1"), key("i2")],
  };
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], legacy);
  try {
    const parts = await split(source, join(root, "parts"), MEDIA);
    assert.equal(parts.length, 3);
    const keys = [...Object.keys(legacy), "media"].sort();
    for (const part of parts) assert.deepEqual(Object.keys(part).sort(), keys);
    assert.deepEqual(parts[0].enrichments, []);
    assert.deepEqual(parts.slice(1).map(ids), [["i1"], ["i2"]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a count that disagrees with the manifest or a cut-off last line stops the split", async () => {
  const manifest = { categories: [], labels: [], images: [], logos: [], products: [], enrichments: [{ supplier_item_id: "i1", image_id: null }] };
  const counted = await bundle([], manifest);
  const truncated = await bundle([], manifest);
  try {
    const path = join(counted.source, "manifest.json");
    await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), enrichmentCount: 2 }));
    await assert.rejects(splitStorefrontBundle(counted.source, join(counted.root, "parts"), MEDIA), /has 1 enrichments, the manifest says 2/);
    await appendFile(join(truncated.source, ENRICHMENTS_FILE), '{"supplier_item_id":"i2","image_id":nu');
    await assert.rejects(splitStorefrontBundle(truncated.source, join(truncated.root, "parts"), MEDIA), /Truncated enrichments file/);
  } finally {
    await rm(counted.root, { recursive: true, force: true });
    await rm(truncated.root, { recursive: true, force: true });
  }
});

test("an export without enrichmentsFile or a mapping without its enrichment stops the split", async () => {
  const { root, source } = await bundle([], {
    categories: [], labels: [], images: [], logos: [], enrichments: [{ supplier_item_id: "i1", image_id: null }],
    products: [{ supplier_item_id: "i1", category_id: 1 }, { supplier_item_id: "i9", category_id: 1 }],
  });
  try {
    await assert.rejects(splitStorefrontBundle(source, join(root, "parts"), MEDIA), /Product mapping without enrichment: i9/);
    const path = join(source, "manifest.json");
    // A manifest in the pre-#1316 inline format is no export this split accepts.
    const inline = JSON.parse(await readFile(path, "utf8"));
    delete inline.enrichmentsFile;
    await writeFile(path, JSON.stringify({ ...inline, enrichments: [] }));
    await assert.rejects(splitStorefrontBundle(source, join(root, "other"), MEDIA), /names no enrichmentsFile/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
