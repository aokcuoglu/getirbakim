// Golden-file guard for the part-NN/manifest.json format (#1358). The split ships with the main checkout, the importer only with a release
// (release-aws), so the format is their contract. The "storefront part format" test below compares a normalized schema of part-00, all job parts
// and all enrichment parts (keys, JSON value types, element schemas of arrays, recursively) with scripts/fixtures/storefront-part-format.json.
// Scope: it guards the split's own output: the top-level keys and types, which arrays each part kind blanks, and that rows pass through intact for the
// row shapes in the fixture (written from the export SELECTs and the columns the importer reads). It cannot see an export or importer column change
// by itself; that needs an export -> split -> import run on a database. Values are not compared, only keys and types.
// If the format change is intended: release the importer first (backward compatible), then change the split, then regenerate the golden file with
//   UPDATE_GOLDEN=1 node --import tsx --test scripts/test-storefront-split.ts   (refused in CI)
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { ENRICHMENTS_FILE, ITEMS_FILE, JOBS_FILE, MEDIA_FILE, PRODUCTS_FILE, readNdjson, writeNdjson } from "./storefront-bundle-stream";

type Row = Record<string, unknown>;
type Rows = { enrichments?: Row[]; jobs?: Row[]; items?: Row[]; products?: Row[] };

// An export directory as export-storefront-bundle.ts writes it (#1316, #1317): enrichments, jobs, supplier item keys,
// category mappings and media rows go to NDJSON files, the manifest names each file and its row count.
async function bundle(media: { id: string; key: string; size: number; row?: Row }[], { enrichments = [], jobs = [], items = [], products = [], ...manifest }: Row & Rows) {
  const root = await mkdtemp(join(tmpdir(), "storefront-split-"));
  const source = join(root, "full");
  await mkdir(source);
  for (const object of media) {
    await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
    await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
  }
  const rows = media.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size, ...object.row }));
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    snapshotAt: "2026-10-26T00:00:00Z", ...manifest,
    enrichmentsFile: ENRICHMENTS_FILE, enrichmentCount: await writeNdjson(join(source, ENRICHMENTS_FILE), enrichments),
    jobsFile: JOBS_FILE, jobCount: await writeNdjson(join(source, JOBS_FILE), jobs),
    itemsFile: ITEMS_FILE, itemCount: await writeNdjson(join(source, ITEMS_FILE), items),
    productsFile: PRODUCTS_FILE, productCount: await writeNdjson(join(source, PRODUCTS_FILE), products),
    mediaFile: MEDIA_FILE, mediaCount: await writeNdjson(join(source, MEDIA_FILE), rows),
  }));
  return { root, source };
}
const read = async (dir: string) => JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
const split = async (source: string, out: string, limits: { mediaBytes: number; jsonBytes: number }) => Promise.all((await splitStorefrontBundle(source, out, limits)).map(read));
// Cut by media bytes only, as before #1316.
const MEDIA = { mediaBytes: 100, jsonBytes: 1e9 };
// A row's bytes in an NDJSON file, and in a part's manifest.json with the comma after it.
const lineBytes = (row: Row) => Buffer.byteLength(JSON.stringify(row)) + 1;
const ids = (part: { enrichments: { supplier_item_id: string }[] }) => part.enrichments.map(row => row.supplier_item_id);
const jobIds = (part: { jobs: { supplier_item_id: string }[] }) => part.jobs.map(row => row.supplier_item_id);
const itemIds = (part: { items: { id: string }[] }) => part.items.map(item => item.id);
const key = (id: string) => ({ id, supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: `CODE ${id}` });
// Fixed-length ids, so every job of a fixture has the same size.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const range = (n: number) => Array.from({ length: n }, (_, index) => index);
// The keys of a part's manifest.json in the format the released importer reads (import-storefront-bundle.ts).
const LEGACY_KEYS = ["categories", "enrichments", "exportedAt", "images", "invalidatedJobs", "items", "jobs", "labels", "logos", "maxDeletions", "media", "products",
  "retried", "since", "snapshotAt", "tombstones", "vehicleImages", "vehicleSpecs"];

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
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], {
    categories: [], labels: [], images: [], logos: [{ brand_key: "febi", evidence_product_id: "i9" }],
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }],
    products: [{ supplier_item_id: "i2", category_id: 1 }],
    items: [key("i1"), key("i2"), key("i9")],
  });
  try {
    const parts = await Promise.all((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).map(read));
    assert.deepEqual(parts.map(itemIds), [["i9"], ["i1"], ["i2"]]);
    assert.deepEqual(parts[2].items[0], key("i2"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a bundle without enrichments or jobs is a single part", async () => {
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [] });
  try {
    assert.equal((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("job statuses fill the job parts after part 0, each with its own supplier item keys; the enrichment parts follow", async () => {
  const jobs = [{ supplier_item_id: "i1", status: "complete" }, { supplier_item_id: "i8", status: "partial" }, { supplier_item_id: "i9", status: "complete" }];
  const tombstones = [{ supplier_item_id: "i7", kind: "enrichment_deleted" }];
  const { root, source } = await bundle([{ id: "c", key: "cat/c.jpg", size: 10 }, { id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], {
    categories: [{ source: "trodo", category_id: 1 }], labels: [], images: [{ source: "trodo", category_id: 1, media_id: "c" }], logos: [{ brand_key: "febi" }],
    vehicleSpecs: [{ vehicle_type_id: 7 }], vehicleImages: [], tombstones, invalidatedJobs: 3, maxDeletions: 25, jobs,
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }], products: [{ supplier_item_id: "i2", category_id: 1 }],
    items: [key("i1"), key("i2"), key("i7"), key("i8"), key("i9")],
  });
  try {
    // Room for two jobs with their keys per part.
    const unit = (job: Row) => lineBytes(job) + lineBytes(key(job.supplier_item_id as string));
    const parts = await split(source, join(root, "parts"), { mediaBytes: 100, jsonBytes: unit(jobs[0]) + unit(jobs[1]) });
    assert.equal(parts.length, 5);
    assert.deepEqual(parts.map(jobIds), [[], ["i1", "i8"], ["i9"], [], []]);
    assert.deepEqual(parts.map(ids), [[], [], [], ["i1"], ["i2"]]);
    assert.deepEqual(parts.map(itemIds), [["i7"], ["i1", "i8"], ["i9"], ["i1"], ["i2"]]);
    assert.deepEqual(parts[1].jobs, jobs.slice(0, 2));
    // Part 0 keeps the always-complete data and its media.
    assert.deepEqual([parts[0].tombstones, parts[0].invalidatedJobs, parts[0].logos, parts[0].vehicleSpecs], [tombstones, 3, [{ brand_key: "febi" }], [{ vehicle_type_id: 7 }]]);
    assert.deepEqual(parts[0].media.map((m: { id: string }) => m.id), ["c"]);
    for (const part of parts.slice(1, 3)) {
      // Deletions are applied once (part 0), and the invalidated job count is summed over the parts.
      assert.deepEqual([part.tombstones, part.invalidatedJobs], [[], 0]);
      assert.deepEqual([part.images, part.logos, part.vehicleSpecs, part.vehicleImages, part.products, part.enrichments, part.media], [[], [], [], [], [], [], []]);
      assert.deepEqual([part.categories, part.snapshotAt, part.maxDeletions], [[{ source: "trodo", category_id: 1 }], "2026-10-26T00:00:00Z", 25]);
    }
    assert.deepEqual(parts.map(part => part.invalidatedJobs), [3, 0, 0, 0, 0]);
    assert.deepEqual(parts[4].products, [{ supplier_item_id: "i2", category_id: 1 }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("no part grows with the job count: N and 2N jobs give parts of the same size, only more of them", async () => {
  const job = (n: number) => ({
    supplier_item_id: uuid(n), supplier_code: `C${String(n).padStart(6, "0")}`, supplier_brand: "FEBI", oem: "", status: "complete", candidate_url: null,
    last_attempt_at: "2026-11-24T01:00:00.000Z",
  });
  const unit = lineBytes(job(0)) + lineBytes(key(uuid(0)));
  const limit = unit * 5 + Math.floor(unit / 2);
  const run = async (count: number) => {
    const { root, source } = await bundle([], {
      categories: [{ source: "trodo", category_id: 1, name: "Fren" }], labels: [], images: [], logos: [{ brand_key: "febi", evidence_product_id: uuid(999_999) }],
      vehicleSpecs: [{ vehicle_type_id: 7 }], vehicleImages: [], tombstones: [{ supplier_item_id: uuid(999_998), kind: "enrichment_deleted" }], invalidatedJobs: 2,
      jobs: range(count).map(job), items: [...range(count).map(n => key(uuid(n))), key(uuid(999_998)), key(uuid(999_999))],
    });
    try {
      const dirs = await splitStorefrontBundle(source, join(root, "parts"), { mediaBytes: 100, jsonBytes: limit });
      return { sizes: await Promise.all(dirs.map(async dir => (await stat(join(dir, "manifest.json"))).size)), parts: await Promise.all(dirs.map(read)) };
    } finally { await rm(root, { recursive: true, force: true }); }
  };
  const small = await run(23);
  const large = await run(46);
  for (const [result, count] of [[small, 23], [large, 46]] as const) {
    const jobParts = result.parts.slice(1);
    assert.deepEqual(jobParts.map(part => part.jobs.length), [...range(Math.floor(count / 5)).map(() => 5), count % 5]);
    for (const [index, part] of jobParts.entries()) {
      // What the part would weigh without its rows: the category tree and the blanked keys.
      const empty = Buffer.byteLength(JSON.stringify({ ...part, jobs: [], items: [] }));
      assert.ok(result.sizes[index + 1] <= empty + Math.max(limit, unit), `${result.sizes[index + 1]} > ${empty} + ${limit}`);
      assert.deepEqual(itemIds(part), jobIds(part));
    }
    const all = jobParts.flatMap(jobIds);
    assert.deepEqual(all, range(count).map(uuid));
    assert.equal(new Set(all).size, count);
  }
  // Part 0 holds no jobs, so it does not grow with them; neither does the largest job part.
  assert.equal(small.sizes[0], large.sizes[0]);
  assert.deepEqual(small.parts[0].jobs, []);
  assert.equal(Math.max(...small.sizes.slice(1)), Math.max(...large.sizes.slice(1)));
  assert.ok(large.parts.length > small.parts.length);
});

test("an enrichment part stays under the JSON cap with its mappings, media rows and supplier item keys", async () => {
  // Two enrichments share each image; every other one has two category mappings.
  const enrichments = range(24).map(n => ({ supplier_item_id: uuid(n), image_id: `m${Math.floor(n / 2)}`, payload: { vehicles: "x".repeat(10 + (n % 3) * 25) } }));
  const products = range(24).filter(n => n % 2).flatMap(n => [1, 2].map(category => ({ supplier_item_id: uuid(n), source: "trodo", category_id: category })));
  const media = range(12).map(n => ({ id: `m${n}`, key: `p/m${n}.jpg`, size: 1 }));
  const { root, source } = await bundle(media, {
    categories: [{ source: "trodo", category_id: 1 }, { source: "trodo", category_id: 2 }], labels: [], images: [], logos: [],
    enrichments, products, items: range(24).map(n => key(uuid(n))),
  });
  try {
    // The most an enrichment can bring into a part: its line, its mappings, its media row and its key.
    const mediaRow = (id: string) => { const object = media.find(row => row.id === id)!; return { id, object_key: object.key, size_bytes: object.size }; };
    const units = enrichments.map(row => lineBytes(row) + products.filter(product => product.supplier_item_id === row.supplier_item_id).reduce((sum, product) => sum + lineBytes(product), 0)
      + lineBytes(mediaRow(row.image_id)) + lineBytes(key(row.supplier_item_id)));
    const limit = Math.max(...units) * 3;
    const dirs = await splitStorefrontBundle(source, join(root, "parts"), { mediaBytes: 1e9, jsonBytes: limit });
    const parts = await Promise.all(dirs.map(read));
    assert.ok(parts.length > 3);
    for (const [index, part] of parts.entries()) {
      if (index === 0) continue;
      const empty = Buffer.byteLength(JSON.stringify({ ...part, enrichments: [], products: [], media: [], items: [] }));
      const size = (await stat(join(dirs[index], "manifest.json"))).size;
      assert.ok(size <= empty + Math.max(limit, ...units), `part ${index}: ${size} > ${empty} + ${limit}`);
    }
    assert.deepEqual(parts.flatMap(ids), enrichments.map(row => row.supplier_item_id));
    assert.deepEqual(parts.flatMap(part => part.products), products);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tombstones and the invalidated job count go whole in part 0; later parts carry none", async () => {
  const tombstones = [{ supplier_item_id: "i7", kind: "enrichment_deleted" }, { supplier_item_id: "i8", kind: "job_invalidated" }];
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], {
    categories: [], labels: [], images: [], logos: [], tombstones, invalidatedJobs: 3, maxDeletions: 25,
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }],
    items: [key("i1"), key("i2"), key("i7"), key("i8")],
  });
  try {
    const parts = await Promise.all((await splitStorefrontBundle(source, join(root, "parts"), MEDIA)).map(read));
    assert.equal(parts.length, 3);
    assert.deepEqual(parts[0].tombstones, tombstones);
    assert.deepEqual(parts.slice(1).map(part => part.tombstones), [[], []]);
    assert.deepEqual(parts.map(itemIds), [["i7", "i8"], ["i1"], ["i2"]]);
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
    // Room for two enrichments with up to one mapping each.
    const parts = await split(source, join(root, "parts"), { mediaBytes: 100, jsonBytes: (lineBytes(enrichments[0]) + lineBytes({ supplier_item_id: "i3", category_id: 1 })) * 2 });
    assert.deepEqual(parts.map(ids), [[], ["i1", "i2"], ["i3", "i4"], ["i5"]]);
    assert.equal(parts.reduce((sum, part) => sum + part.enrichments.length, 0), 5);
    assert.deepEqual(parts.map(part => part.products.length), [0, 0, 1, 2]);
    for (const part of parts.slice(1)) assert.deepEqual(part.categories, [{ source: "trodo", category_id: 1 }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an enrichment larger than the JSON cap gets a part of its own; no part is empty", async () => {
  const small = (id: string) => ({ supplier_item_id: id, image_id: null, payload: {} });
  const huge = { supplier_item_id: "i2", image_id: null, payload: { vehicles: "v".repeat(5000) } };
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], enrichments: [small("i1"), huge, small("i3")] });
  try {
    const parts = await split(source, join(root, "parts"), { mediaBytes: 100, jsonBytes: lineBytes(small("i1")) * 3 });
    assert.deepEqual(parts.map(ids), [[], ["i1"], ["i2"], ["i3"]]);
    assert.deepEqual(parts[2].enrichments[0], huge);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("enrichment text survives the line format: U+2028/U+2029, escaped newlines, multi-byte text across read chunks", async () => {
  const enrichment = {
    supplier_item_id: "i1", image_id: null, imported_at: "2026-11-23T01:30:00.000Z",
    payload: { name: "Fren balatası ön arka", note: "line 1\nline 2\r\n", vehicles: "Şğ€".repeat(60_000) },
  };
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], enrichments: [enrichment, { supplier_item_id: "i2", image_id: null }] });
  try {
    // JSON.stringify leaves U+2028 as it is: a reader splitting on it (node:readline) would cut this line.
    assert.ok((await readFile(join(source, ENRICHMENTS_FILE), "utf8")).includes(" "));
    const lines: { row: Row; bytes: number }[] = [];
    for await (const line of readNdjson(join(source, ENRICHMENTS_FILE))) lines.push(line);
    assert.deepEqual(lines.map(line => line.row), [enrichment, { supplier_item_id: "i2", image_id: null }]);
    assert.deepEqual(lines.map(line => line.bytes), [lineBytes(enrichment), lineBytes({ supplier_item_id: "i2", image_id: null })]);
    const parts = await split(source, join(root, "parts"), MEDIA);
    assert.deepEqual(parts[1].enrichments[0], enrichment);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("every part, job parts included, has exactly the keys of the format the released importer reads", async () => {
  const legacy = {
    exportedAt: "2026-11-23T01:30:00Z", since: "2026-11-22T00:30:03.779Z", retried: 0, snapshotAt: "2026-11-23T01:29:00Z",
    categories: [], labels: [], images: [], products: [{ supplier_item_id: "i2", category_id: 1 }],
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }],
    logos: [], vehicleSpecs: [], vehicleImages: [], jobs: [{ supplier_item_id: "i1", status: "complete" }], tombstones: [], invalidatedJobs: 0, maxDeletions: 1000,
    items: [key("i1"), key("i2")],
  };
  assert.deepEqual([...Object.keys(legacy), "media"].sort(), LEGACY_KEYS);
  const { root, source } = await bundle([{ id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 60 }], legacy);
  try {
    const parts = await split(source, join(root, "parts"), MEDIA);
    assert.equal(parts.length, 4);
    for (const part of parts) {
      assert.deepEqual(Object.keys(part).sort(), LEGACY_KEYS);
      // No NDJSON file name or count of the export reaches a part.
      assert.ok(!Object.keys(part).some(name => /(File|Count)$/.test(name)), Object.keys(part).join());
    }
    assert.deepEqual(parts.map(jobIds), [[], ["i1"], [], []]);
    assert.deepEqual(parts.map(ids), [[], [], ["i1"], ["i2"]]);
    // A job part has the very keys of an enrichment part.
    assert.deepEqual(Object.keys(parts[1]).sort(), Object.keys(parts[2]).sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a count that disagrees with the manifest or a cut-off last line stops the split", async () => {
  const manifest = {
    categories: [], labels: [], images: [], logos: [], enrichments: [{ supplier_item_id: "i1", image_id: null }],
    jobs: [{ supplier_item_id: "i1", status: "complete" }], items: [key("i1")],
  };
  const cases: [Row | null, string | null, RegExp][] = [
    [{ enrichmentCount: 2 }, null, /enrichments\.ndjson has 1 enrichments, the manifest says 2/],
    [{ jobCount: 2 }, null, /jobs\.ndjson has 1 jobs, the manifest says 2/],
    [{ itemCount: 3 }, null, /items\.ndjson has 1 supplier item keys, the manifest says 3/],
    [{ mediaCount: 1 }, null, /media\.ndjson has 0 media rows, the manifest says 1/],
    [{ productCount: 1 }, null, /products\.ndjson has 0 product mappings, the manifest says 1/],
    [null, ENRICHMENTS_FILE, /Truncated NDJSON file: .*enrichments\.ndjson/],
    [null, JOBS_FILE, /Truncated NDJSON file: .*jobs\.ndjson/],
    [null, ITEMS_FILE, /Truncated NDJSON file: .*items\.ndjson/],
  ];
  for (const [counts, truncate, pattern] of cases) {
    const { root, source } = await bundle([], manifest);
    try {
      const path = join(source, "manifest.json");
      if (counts) await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")), ...counts }));
      if (truncate) await appendFile(join(source, truncate), '{"supplier_item_id":"i2","status":nu');
      await assert.rejects(splitStorefrontBundle(source, join(root, "parts"), MEDIA), pattern);
    } finally { await rm(root, { recursive: true, force: true }); }
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

test("an export written before #1317 (jobs, items, mappings or media inline) or naming a file outside it stops the split", async () => {
  const { root, source } = await bundle([], { categories: [], labels: [], images: [], logos: [], jobs: [{ supplier_item_id: "i1", status: "complete" }] });
  try {
    const path = join(source, "manifest.json");
    const exported = JSON.parse(await readFile(path, "utf8"));
    for (const [file, count] of [["jobsFile", "jobCount"], ["itemsFile", "itemCount"], ["productsFile", "productCount"], ["mediaFile", "mediaCount"]]) {
      await writeFile(path, JSON.stringify(Object.fromEntries(Object.entries(exported).filter(([name]) => name !== file && name !== count))));
      await assert.rejects(splitStorefrontBundle(source, join(root, "parts"), MEDIA), new RegExp(`names no ${file} and ${count}: export it again with this version`));
    }
    await writeFile(path, JSON.stringify({ ...exported, jobsFile: "../jobs.ndjson" }));
    await assert.rejects(splitStorefrontBundle(source, join(root, "parts"), MEDIA), /Unsafe jobsFile: \.\.\/jobs\.ndjson/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// JSON schema of values seen at one position: a type name, an object of its keys' schemas, or { "[]": element schema }; mixed types list "oneOf".
function describe(values: unknown[]): unknown {
  if (!values.length) return "empty";
  const nodes = new Map<string, unknown>();
  for (const kind of new Set(values.map(value => value === null ? "null" : Array.isArray(value) ? "array" : typeof value))) {
    const of = values.filter(value => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value) === kind);
    if (kind === "array") nodes.set(kind, { "[]": describe(of.flat()) });
    else if (kind === "object") {
      const names = [...new Set(of.flatMap(value => Object.keys(value as Row)))].sort();
      nodes.set(kind, Object.fromEntries(names.map(name => [name, describe(of.filter(value => name in (value as Row)).map(value => (value as Row)[name]))])));
    } else nodes.set(kind, kind);
  }
  const all = [...nodes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, node]) => node);
  return all.length === 1 ? all[0] : { oneOf: all };
}

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "storefront-part-format.json");

test("storefront part format: part-00, the job parts and the enrichment parts match the golden schema", async () => {
  const jobs = [uuid(1), uuid(2)].map((id, index) => ({
    supplier_item_id: id, supplier_code: `C00000${index}`, supplier_brand: "FEBI", oem: "", status: index ? "partial" : "complete", candidate_url: index ? "https://example.test/p" : null,
    last_attempt_at: "2026-11-24T01:00:00.000Z",
  }));
  const enrichments = [uuid(1), uuid(2)].map((id, index) => ({
    supplier_item_id: id, supplier_code: `C00000${index}`, supplier_brand: "FEBI", source_url: "https://example.test/p", source_method: "trodo",
    manufacturer: "FEBI", manufacturer_part_number: `P-${index}`, image_id: index ? null : "a", payload: { name: "Fren balatası", vehicles: ["Ford"] },
    imported_at: "2026-11-23T01:30:00.000Z", match_basis: { type: "exact_part" },
  }));
  const sha = (n: number) => String(n).repeat(64);
  const mediaRow = (n: number) => ({ bucket: "product-media", sha256: sha(n), content_type: "image/webp", source_url: "https://example.test/i.webp", created_at: "2026-11-01T00:00:00.000Z", stored_at: null });
  const { root, source } = await bundle([
    { id: "c", key: "cat/c.webp", size: 10, row: mediaRow(1) }, { id: "v", key: "veh/v.webp", size: 10, row: mediaRow(2) }, { id: "a", key: "p/a.webp", size: 10, row: mediaRow(3) },
  ], {
    exportedAt: "2026-11-23T01:30:00Z", since: null, retried: 0, snapshotAt: "2026-11-23T01:29:00Z",
    categories: [{ source: "trodo", category_id: 1, parent_id: null, name: "Fren", slug: "fren", path_ids: [1], source_url: "https://example.test/c/1", raw: { id: 1 }, fetched_at: "2026-11-01T00:00:00.000Z" }],
    labels: [{ source: "trodo", category_id: 1, locale: "tr", name: "Fren", slug: "fren" }],
    images: [{ source: "trodo", category_id: 1, media_id: "c", width: 64, height: 64 }],
    logos: [{ brand_key: "FEBI", manufacturer: "FEBI", image_data: "\\x89504e47", sha256: sha(4), width: 64, height: 32, source_url: "https://example.test/l.png",
      evidence_product_id: uuid(1), evidence_source_url: "https://example.test/p", imported_at: "2026-11-01T00:00:00.000Z" }],
    vehicleSpecs: [{ vehicle_type_id: 7, outcome: "found", detail: null, full_name: "Ford Focus 1.6", body_type: "Hatchback", drive_type: "FWD", engine_type: "Petrol", fuel_mixture: "Injection",
      cylinders: 4, valves: 16, engine_codes: ["HXDA"], kba_numbers: ["8009/AEK"], fetched_at: "2026-11-01T00:00:00.000Z" }],
    vehicleImages: [{ vehicle_type_id: 7, media_id: "v", original_media_id: null, width: 512, height: 256, imported_at: "2026-11-01T00:00:00.000Z" }],
    tombstones: [{ supplier_item_id: uuid(9), supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: "CODE 9", kind: "enrichment_deleted", source_method: null,
      recorded_at: "2026-11-20T00:00:00.000Z" }],
    invalidatedJobs: 1, maxDeletions: 1000,
    jobs, enrichments, products: [{ supplier_item_id: uuid(1), source: "trodo", category_id: 1 }],
    items: [key(uuid(1)), key(uuid(2)), key(uuid(9))],
  });
  try {
    // One job with its key per job part; part 0 has no byte limit.
    const parts = await split(source, join(root, "parts"), { mediaBytes: 1e9, jsonBytes: lineBytes(jobs[0]) + lineBytes(key(uuid(1))) });
    const jobParts = parts.filter((part, index) => index && part.jobs.length);
    const enrichmentParts = parts.filter(part => part.enrichments.length);
    assert.ok(parts[0].jobs.length === 0 && jobParts.length > 1 && enrichmentParts.length > 1, "fixture must give part-00, job parts and enrichment parts");
    const schema = { "part-00": describe([parts[0]]), "job parts": describe(jobParts), "enrichment parts": describe(enrichmentParts) };
    const text = `${JSON.stringify(schema, null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === "1") {
      if (process.env.CI) assert.fail("UPDATE_GOLDEN is not allowed in CI");
      await mkdir(dirname(GOLDEN), { recursive: true });
      await writeFile(GOLDEN, text);
      return;
    }
    assert.deepEqual(schema, JSON.parse(await readFile(GOLDEN, "utf8")),
      "the storefront part format changed: the AWS importer reads this format; release the importer first (backward compatible), then change the split. "
      + "If the change is intended, regenerate the golden file with `UPDATE_GOLDEN=1 node --import tsx --test scripts/test-storefront-split.ts`.");
  } finally { await rm(root, { recursive: true, force: true }); }
});
