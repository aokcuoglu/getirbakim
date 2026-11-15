import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { galleryImages, socialImage } from "../src/modules/store/product-image-display";
import { prepareProductImage, ProductImageError } from "../src/modules/admin/product-image-upload";
import { automaticImageHiddenSql, hiddenAutomaticItemsSql, itemProductSql, shownImageSql, uploadedImageSql } from "../src/modules/store/product-image-sql";

// Admin-uploaded product images (#581) in an isolated copy of the schema: db/product-override-images.sql, the store's
// read path, the admin store and merge carry/undo. Uploaded bytes go to an in-memory object store.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: typeof import("../src/modules/admin/product-image-store");
let enrichment: typeof import("../src/modules/store/product-enrichment");
let images: typeof import("../src/modules/store/product-images");
let overrides: typeof import("../src/modules/admin/product-override-store");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug, , dinamik] = storefrontCompanies();
let admin: string;
process.env.S3_BUCKET ??= "product-media";

/** Object store keeping what was put, as S3 answers HeadObject for it. */
function fakeStorage() {
  const objects = new Map<string, { length: number; sha256?: string }>();
  return { objects, send: async (command: { constructor: { name: string }; input: { Key: string; Body?: Buffer; Metadata?: Record<string, string> } }) => {
    if (command.constructor.name === "PutObjectCommand") {
      objects.set(command.input.Key, { length: command.input.Body!.length, sha256: command.input.Metadata?.sha256 });
      return {};
    }
    const object = objects.get(command.input.Key);
    if (!object) throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });
    return { ContentLength: object.length, Metadata: object.sha256 ? { sha256: object.sha256 } : {} };
  } };
}
const storage = fakeStorage();

// Distinct sizes: lossy WebP can turn nearby solid colours into the same bytes (a duplicate).
const solid = (shade: number, width = 200 + shade, height = 300) =>
  sharp({ create: { width, height, channels: 3, background: { r: shade, g: 120, b: 40 } } }).jpeg().toBuffer();

type Item = { supplier: "basbug" | "dinamik"; code: string; brand: string; name: string };
async function item(key: string, { supplier, code, brand, name }: Item) {
  const product = { uk: brand, ac: name, ac2: "", dc: "TL", ...(supplier === "dinamik" ? { marka: brand, stokAdi: name } : {}) };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code, product]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const card = (key: string, code: string, brand: string) => ({ id: ids[key], code, brand });
const upload = async (productId: string, bytes: Buffer, name = "foto.jpg") => store.addProductImage(schema.pool, productId, { bytes, name }, admin, storage);
const fileNames = async (productId: string) => (await store.loadProductImages(schema.pool, productId)).images.map(image => image.file_name);
const merge = (source: string, target: string) => schema.pool.query<{ id: string | null; carried: { images: number; hide_automatic: boolean; kept: boolean } }>(
  `WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT id::text, product_override_images_carry($1, id, $3) AS carried FROM merged`, [source, target, admin]);
const history = async (productId: string) => (await schema.pool.query<{ field: string; old_value: string | null; new_value: string | null; reason: string | null }>(
  "SELECT field,old_value,new_value,reason FROM product_override_changes WHERE product_id=$1 ORDER BY id", [productId])).rows;
let automaticMedia: string;

before(async () => {
  schema = await isolatedSchema("product_override_images_test");
  await item("febiBasbug", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI" });
  await item("febiDinamik", { supplier: "dinamik", code: "FEBI 10010", brand: "FEBI", name: "FEBI BALATA ON" });
  await item("mahle", { supplier: "basbug", code: "MAH 20020", brand: "MAHLE", name: "MAHLE YAG FILTRESI" });
  await item("ngk", { supplier: "basbug", code: "NGK 30030", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 40040", brand: "SKF", name: "SKF RULMAN" });
  await item("bosch", { supplier: "basbug", code: "BOS 70070", brand: "BOSCH", name: "BOSCH SILECEK" });
  await item("conti", { supplier: "basbug", code: "CON 80080", brand: "CONTITECH", name: "CONTI KAYIS" });
  await item("lemA", { supplier: "basbug", code: "LEM 90090", brand: "LEMFORDER", name: "LEMFORDER ROT" });
  await item("lemB", { supplier: "basbug", code: "TRW 91091", brand: "TRW", name: "TRW ROT" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  // An enrichment image on the Dinamik FEBI row, shared with the Başbuğ row of the same product.
  automaticMedia = (await schema.pool.query<{ id: string }>(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url)
    VALUES('product-media','products/aa/auto.webp',$1,'image/webp',1000,'https://www.trodo.com/a.webp') RETURNING id::text`,
  [createHash("sha256").update("automatic").digest("hex")])).rows[0].id;
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,'FEBI 10010','FEBI','complete')`, [ids.febiDinamik]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload)
    VALUES($1,'FEBI 10010','FEBI','https://www.trodo.com/febi','test','FEBI BILSTEIN','10010',$2,$3)`,
  [ids.febiDinamik, automaticMedia, JSON.stringify({ specifications: [], oemNumbers: {}, crossReferences: {}, vehicles: [], imageWidth: 600, imageHeight: 400 })]);
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  const [{ db }, storeModule, enrichmentModule, imagesModule, overridesModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/admin/product-image-store"),
    import("../src/modules/store/product-enrichment"), import("../src/modules/store/product-images"), import("../src/modules/admin/product-override-store")]);
  store = storeModule;
  overrides = overridesModule;
  enrichment = enrichmentModule;
  images = imagesModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("an upload is converted to WebP, turned upright and capped at 2000 px", async () => {
  const wide = await prepareProductImage(await solid(10, 3000, 1000));
  assert.deepEqual([wide.width, wide.height], [2000, 667]);
  assert.equal((await sharp(wide.bytes).metadata()).format, "webp");
  // EXIF orientation 6 (rotated 90°): stored upright, without the EXIF block.
  const rotated = await prepareProductImage(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#336699" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer());
  assert.deepEqual([rotated.width, rotated.height], [300, 400]);
  const meta = await sharp(rotated.bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  // A small image is never enlarged; PNG is accepted.
  const png = await prepareProductImage(await sharp({ create: { width: 250, height: 220, channels: 4, background: "#ffffff00" } }).png().toBuffer());
  assert.deepEqual([png.width, png.height], [250, 220]);
});

test("GIFs, text, small and broken files are refused with a reason", async () => {
  const reason = (bytes: Buffer) => prepareProductImage(bytes).then(() => "accepted", (error: unknown) => error instanceof ProductImageError ? error.reason : "other");
  assert.equal(await reason(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#000" } }).gif().toBuffer()), "type");
  assert.equal(await reason(Buffer.from("merhaba dünya")), "unreadable");
  assert.equal(await reason(await solid(20, 199, 600)), "dimensions");
  const jpeg = await solid(30, 800, 800);
  assert.equal(await reason(jpeg.subarray(0, Math.floor(jpeg.length / 2))), "unreadable");
  assert.equal(await reason(Buffer.alloc(0)), "size");
  assert.equal(await reason(Buffer.alloc(8 * 1024 * 1024 + 1)), "size");
  // Above 25 megapixels.
  assert.equal(await reason(await sharp({ create: { width: 5100, height: 5000, channels: 3, background: "#123456" } }).jpeg({ quality: 40 }).toBuffer()), "dimensions");
  // One image at a time per process: a refused file does not stop the ones queued behind it.
  const results = await Promise.all([solid(31), Promise.resolve(Buffer.from("bozuk")), solid(32)].map(async bytes => reason(await bytes)));
  assert.deepEqual(results, ["accepted", "unreadable", "accepted"]);
});

test("the gallery lists uploads, then the automatic image unless hidden, each source once", () => {
  const a = { src: "/api/product-media/a", width: 1, height: 1 }, b = { src: "/api/product-media/b", width: 1, height: 1 };
  const auto = { src: "/api/product-media/auto", width: 1, height: 1 };
  assert.deepEqual(galleryImages([a, b], auto, false), [a, b, auto]);
  assert.deepEqual(galleryImages([a, b], auto, true), [a, b]);
  assert.deepEqual(galleryImages([], auto, false), [auto]);
  assert.deepEqual(galleryImages([], null, false), []);
  assert.deepEqual(galleryImages([a, a], { ...a }, false), [a]);
});

test("the share image is the gallery's first image, sized when known, else the site image (#595)", () => {
  const fallback = { url: "/brand/social.png", width: 1080, height: 1080, alt: "Getirbakim" };
  const upload = { src: "/api/product-media/up", width: 800, height: 600 }, auto = { src: "/api/product-media/auto", width: 600, height: 400 };
  assert.deepEqual(socialImage(galleryImages([upload], auto, false), "FEBI 10010", fallback), { url: upload.src, alt: "FEBI 10010", width: 800, height: 600 });
  assert.deepEqual(socialImage(galleryImages([], auto, false), "FEBI 10010", fallback), { url: auto.src, alt: "FEBI 10010", width: 600, height: 400 });
  // Enrichment rows can lack sizes; Open Graph then gets the URL alone.
  assert.deepEqual(socialImage([{ src: auto.src, width: 0, height: 0 }], "FEBI 10010", fallback), { url: auto.src, alt: "FEBI 10010" });
  assert.deepEqual(socialImage(galleryImages([], auto, true), "FEBI 10010", fallback), fallback);
});

test("without uploads the store shows the automatic image; hidden, it shows none", async () => {
  const febi = await productOf("febiBasbug");
  const cards = [card("febiBasbug", "FEB 10010", "FEBI"), card("febiDinamik", "FEBI 10010", "FEBI")];
  const shown = await enrichment.getCatalogProductImages(cards);
  for (const key of ["febiBasbug", "febiDinamik"]) assert.deepEqual(shown.get(ids[key]), { src: `/api/product-media/${automaticMedia}`, width: 600, height: 400 }, key);
  assert.deepEqual((await store.loadProductImages(schema.pool, febi)).automatic.map(image => image.src), [`/api/product-media/${automaticMedia}`]);
  assert.deepEqual(await store.setAutomaticImageHidden(schema.pool, febi, true, admin), { ok: true });
  assert.equal((await enrichment.getCatalogProductImages(cards)).size, 0);
  assert.deepEqual(await images.getItemImages(ids.febiDinamik), { images: [], hideAutomatic: true });
  // The automatic image itself is unchanged: the product page's enrichment still has it.
  assert.equal((await enrichment.getProductEnrichment(cards[0]))?.imagePath, `/api/product-media/${automaticMedia}`);
  assert.deepEqual(await store.setAutomaticImageHidden(schema.pool, febi, false, admin), { ok: true });
  assert.equal((await enrichment.getCatalogProductImages(cards)).size, 2);
  assert.deepEqual((await history(febi)).map(change => [change.field, change.old_value, change.new_value]),
    [["auto_image_hidden", null, "true"], ["auto_image_hidden", "true", null]]);
});

test("a store brand and part number (#602) keep the automatic image: lookups use the supplier's code and brand", async () => {
  const febi = await productOf("febiBasbug");
  await schema.pool.query("INSERT INTO brands(key,name) VALUES('SCHAEFFLER602','SCHAEFFLER') ON CONFLICT (key) DO NOTHING");
  const saved = await overrides.persistProductOverride(schema.pool, febi, { brand: "SCHAEFFLER", part_number: "F-10010" }, admin);
  assert.ok(saved.ok);
  const { rows } = await schema.pool.query<{ id: string; code: string; brand: string; display_code: string; display_brand: string }>(
    "SELECT id::text,code,brand,display_code,display_brand FROM storefront_catalog WHERE id=$1", [ids.febiDinamik]);
  assert.deepEqual(rows.map(row => [row.code, row.brand, row.display_code, row.display_brand]), [["FEBI 10010", "FEBI", "F-10010", "SCHAEFFLER"]]);
  // The catalog row's raw code and brand, as the store passes them, find the image; the display values would not.
  const raw = rows.map(row => ({ id: row.id, code: row.code, brand: row.brand }));
  assert.equal((await enrichment.getCatalogProductImages(raw)).get(ids.febiDinamik)?.src, `/api/product-media/${automaticMedia}`);
  assert.equal((await enrichment.getProductEnrichment(raw[0]))?.imagePath, `/api/product-media/${automaticMedia}`);
  assert.equal((await enrichment.getCatalogProductImages(rows.map(row => ({ id: row.id, code: row.display_code, brand: row.display_brand })))).size, 0);
  assert.ok((await overrides.persistProductOverride(schema.pool, febi, { brand: null, part_number: null }, admin)).ok);
});

test("an upload reaches every supplier row of the product, before the automatic image", async () => {
  const febi = await productOf("febiBasbug");
  assert.deepEqual(await upload(febi, await solid(40), "on.jpg"), { ok: true });
  assert.deepEqual(await upload(febi, await solid(41), "yan.jpg"), { ok: true });
  const { images: uploaded } = await store.loadProductImages(schema.pool, febi);
  assert.deepEqual(uploaded.map(image => [image.file_name, image.width, image.height, image.carried]), [["on.jpg", 240, 300, false], ["yan.jpg", 241, 300, false]]);
  const cards = [card("febiBasbug", "FEB 10010", "FEBI"), card("febiDinamik", "FEBI 10010", "FEBI")];
  const shown = await enrichment.getCatalogProductImages(cards);
  for (const key of ["febiBasbug", "febiDinamik"]) assert.equal(shown.get(ids[key])?.src, uploaded[0].src, key);
  const page = await images.getItemImages(ids.febiDinamik);
  assert.deepEqual(page.images.map(image => image.src), uploaded.map(image => image.src));
  assert.deepEqual(galleryImages(page.images, { src: `/api/product-media/${automaticMedia}`, width: 600, height: 400 }, page.hideAutomatic).map(image => image.src),
    [...uploaded.map(image => image.src), `/api/product-media/${automaticMedia}`]);
  // Stored once, as WebP under admin/.
  assert.ok([...storage.objects.keys()].some(key => /^admin\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/.test(key)));
});

test("enrichment imports, supplier syncs and matching refreshes leave the uploads alone", async () => {
  const febi = await productOf("febiBasbug");
  const before = await fileNames(febi);
  await schema.pool.query(`UPDATE product_enrichments SET payload=payload||'{"imageWidth":640}',imported_at=now() WHERE supplier_item_id=$1`, [ids.febiDinamik]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload)
    VALUES($1,'FEBI 10010','FEBI','https://www.trodo.com/febi','test','FEBI BILSTEIN','10010',$2,'{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}')
    ON CONFLICT (supplier_item_id) DO UPDATE SET payload=excluded.payload||'{"imageWidth":600,"imageHeight":400}',imported_at=now()`, [ids.febiDinamik, automaticMedia]);
  await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"FEBI YENI AD"}',changed_at=now() WHERE id=ANY($1::uuid[])`, [[ids.febiBasbug, ids.febiDinamik]]);
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  assert.equal(await productOf("febiBasbug"), febi);
  assert.deepEqual(await fileNames(febi), before);
  const shown = await enrichment.getCatalogProductImages([card("febiDinamik", "FEBI 10010", "FEBI")]);
  assert.equal(shown.get(ids.febiDinamik)?.src, (await store.loadProductImages(schema.pool, febi)).images[0].src);
});

test("supplier syncs, enrichment, fitment rebuilds and the storefront bundle never touch the uploads", async () => {
  const supplierImports = (await readdir("src/modules/suppliers")).filter(file => file.endsWith("-import.ts")).map(file => `src/modules/suppliers/${file}`);
  const bundle = (await readdir("scripts")).filter(file => file.startsWith("storefront-bundle-") && file.endsWith(".ts")).map(file => `scripts/${file}`);
  const files = [...supplierImports, ...bundle, "scripts/import-storefront-bundle.ts", "scripts/export-storefront-bundle.ts", "src/modules/suppliers/sync.ts",
    "src/modules/enrichment/import.ts", "src/modules/store/fitment-sync.ts", "scripts/rebuild-product-fitments.ts"];
  assert.ok(supplierImports.length >= 4 && bundle.length >= 4);
  for (const file of files) assert.ok(!/product_override_image/.test(await readFile(file, "utf8")), file);
});

test("order, primary image and delete", async () => {
  const febi = await productOf("febiBasbug");
  assert.deepEqual(await upload(febi, await solid(42), "arka.jpg"), { ok: true });
  const ordered = (await store.loadProductImages(schema.pool, febi)).images;
  assert.deepEqual(ordered.map(image => image.file_name), ["on.jpg", "yan.jpg", "arka.jpg"]);
  // "Ana görsel yap" on the last one.
  assert.deepEqual(await store.reorderProductImages(schema.pool, febi, [ordered[2].id, ordered[0].id, ordered[1].id], admin), { ok: true });
  assert.deepEqual(await fileNames(febi), ["arka.jpg", "on.jpg", "yan.jpg"]);
  assert.equal((await enrichment.getCatalogProductImages([card("febiBasbug", "FEB 10010", "FEBI")])).get(ids.febiBasbug)?.src, ordered[2].src);
  assert.deepEqual((await history(febi)).filter(change => change.field === "image_primary").map(change => [change.old_value, change.new_value]), [["on.jpg", "arka.jpg"]]);
  // A tab that missed a change (an image more or less) is refused.
  assert.deepEqual(await store.reorderProductImages(schema.pool, febi, [ordered[0].id, ordered[1].id], admin), { ok: false, reason: "stale" });
  assert.deepEqual(await store.reorderProductImages(schema.pool, febi, [ordered[0].id, ordered[0].id, ordered[1].id], admin), { ok: false, reason: "stale" });
  assert.deepEqual(await store.removeProductImage(schema.pool, febi, ordered[0].id, admin), { ok: true });
  assert.deepEqual(await fileNames(febi), ["arka.jpg", "yan.jpg"]);
  assert.deepEqual(await store.removeProductImage(schema.pool, febi, ordered[0].id, admin), { ok: false, reason: "stale" });
  assert.deepEqual((await history(febi)).filter(change => change.field.startsWith("image_")).map(change => [change.field, change.old_value, change.new_value]), [
    ["image_added", null, "on.jpg"], ["image_added", null, "yan.jpg"], ["image_added", null, "arka.jpg"], ["image_primary", "on.jpg", "arka.jpg"], ["image_removed", "on.jpg", null]]);
});

test("the product media route serves uploads until no image uses them", async () => {
  const mahle = await productOf("mahle");
  assert.deepEqual(await upload(mahle, await solid(90), "mahle.jpg"), { ok: true });
  const [image] = (await store.loadProductImages(schema.pool, mahle)).images;
  const mediaId = image.src.split("/").pop()!;
  assert.ok(await images.servableProductMedia(mediaId, storefrontCompanies()));
  assert.ok(await images.servableProductMedia(automaticMedia, storefrontCompanies()));
  assert.deepEqual(await store.removeProductImage(schema.pool, mahle, image.id, admin), { ok: true });
  assert.equal(await images.servableProductMedia(mediaId, storefrontCompanies()), undefined);
  // The object stays (#597 collects unreferenced media).
  assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_media_objects WHERE id=$1", [mediaId])).rows[0].n, 1);
});

test("limits: 12 images, no duplicates, no uploads on a merged product", async () => {
  const ngk = await productOf("ngk");
  const first = await solid(100);
  assert.deepEqual(await upload(ngk, first), { ok: true });
  assert.deepEqual(await upload(ngk, first, "kopya.jpg"), { ok: false, reason: "duplicate" });
  for (let shade = 101; shade < 112; shade++) assert.deepEqual(await upload(ngk, await solid(shade)), { ok: true }, String(shade));
  assert.equal((await fileNames(ngk)).length, 12);
  assert.deepEqual(await upload(ngk, await solid(150)), { ok: false, reason: "limit" });
  assert.deepEqual(await upload(ngk, Buffer.from("GIF89a")), { ok: false, reason: "limit" });
  const skf = await productOf("skf");
  assert.deepEqual(await upload(skf, await sharp({ create: { width: 300, height: 300, channels: 3, background: "#000" } }).gif().toBuffer()),
    { ok: false, reason: "image", image: "type" });
  assert.deepEqual(await upload(randomUUID(), await solid(160)), { ok: false, reason: "not-found" });
  // SKF merged into NGK: its page offers no uploads, and the store refuses them.
  assert.equal((await merge(skf, ngk)).rows[0].id, ngk);
  assert.deepEqual(await upload(skf, await solid(161)), { ok: false, reason: "merged" });
  assert.deepEqual(await store.setAutomaticImageHidden(schema.pool, skf, true, admin), { ok: false, reason: "merged" });
});

test("a merge gives an imageless product the merged product's uploads; undoing it takes them back", async () => {
  const lemA = await productOf("lemA"), lemB = await productOf("lemB");
  assert.deepEqual(await upload(lemA, await solid(200), "rot-1.jpg"), { ok: true });
  assert.deepEqual(await upload(lemA, await solid(201), "rot-2.jpg"), { ok: true });
  assert.deepEqual((await merge(lemA, lemB)).rows[0], { id: lemB, carried: { images: 2, hide_automatic: false, kept: false } });
  const carried = await store.loadProductImages(schema.pool, lemB);
  assert.deepEqual(carried.images.map(image => [image.file_name, image.carried]), [["rot-1.jpg", true], ["rot-2.jpg", true]]);
  assert.deepEqual((await history(lemB)).map(change => [change.field, change.new_value, change.reason]), [["image_added", "rot-1.jpg", "carry"], ["image_added", "rot-2.jpg", "carry"]]);
  // Both rows sell as B now and show the carried images; A keeps its own.
  const shown = await enrichment.getCatalogProductImages([card("lemA", "LEM 90090", "LEMFORDER"), card("lemB", "TRW 91091", "TRW")]);
  assert.equal(shown.get(ids.lemA)?.src, carried.images[0].src);
  assert.equal(shown.get(ids.lemB)?.src, carried.images[0].src);
  assert.equal((await fileNames(lemA)).length, 2);
  // "Geri al": A is revived and B gives the carried images back.
  await schema.pool.query("SELECT product_reset_item($1)", [ids.lemA]);
  assert.deepEqual(await fileNames(lemB), []);
  assert.deepEqual((await history(lemB)).slice(2).map(change => [change.field, change.old_value, change.reason]), [["image_removed", "rot-1.jpg", "uncarry"], ["image_removed", "rot-2.jpg", "uncarry"]]);
  assert.equal((await enrichment.getCatalogProductImages([card("lemB", "TRW 91091", "TRW")])).size, 0);
});

test("a product with its own uploads keeps them; an admin change after a merge keeps the carried ones", async () => {
  const bosch = await productOf("bosch"), conti = await productOf("conti");
  assert.deepEqual(await upload(bosch, await solid(210), "bosch.jpg"), { ok: true });
  assert.deepEqual(await upload(conti, await solid(211), "conti.jpg"), { ok: true });
  assert.deepEqual((await merge(bosch, conti)).rows[0].carried, { images: 0, hide_automatic: false, kept: true });
  assert.deepEqual(await fileNames(conti), ["conti.jpg"]);
  await schema.pool.query("SELECT product_reset_item($1)", [ids.bosch]);
  assert.deepEqual(await fileNames(conti), ["conti.jpg"]);

  // Merged again into an imageless product, which the admin then reorders: the images are its own.
  const lemA = await productOf("lemA"), lemB = await productOf("lemB");
  await merge(lemA, lemB);
  const carried = (await store.loadProductImages(schema.pool, lemB)).images;
  assert.equal(carried.length, 2);
  assert.deepEqual(await store.reorderProductImages(schema.pool, lemB, [carried[1].id, carried[0].id], admin), { ok: true });
  assert.ok((await store.loadProductImages(schema.pool, lemB)).images.every(image => !image.carried));
  await schema.pool.query("SELECT product_reset_item($1)", [ids.lemA]);
  assert.deepEqual(await fileNames(lemB), ["rot-2.jpg", "rot-1.jpg"]);
});

test("a hidden automatic image is carried and taken back the same way", async () => {
  await item("valeoA", { supplier: "basbug", code: "VAL 12012", brand: "VALEO", name: "VALEO SILECEK" });
  await item("valeoB", { supplier: "basbug", code: "DEN 13013", brand: "DENSO", name: "DENSO SILECEK" });
  await item("hellaA", { supplier: "basbug", code: "HEL 14014", brand: "HELLA", name: "HELLA FAR" });
  await item("hellaB", { supplier: "basbug", code: "DEP 15015", brand: "DEPO", name: "DEPO FAR" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const [a, b, c, d] = await Promise.all(["valeoA", "valeoB", "hellaA", "hellaB"].map(productOf));
  await store.setAutomaticImageHidden(schema.pool, a, true, admin);
  assert.deepEqual((await merge(a, b)).rows[0].carried, { images: 0, hide_automatic: true, kept: false });
  assert.equal((await store.loadProductImages(schema.pool, b)).hideAutomatic, true);
  assert.deepEqual((await history(b)).map(change => [change.field, change.new_value, change.reason]), [["auto_image_hidden", "true", "carry"]]);
  await schema.pool.query("SELECT product_reset_item($1)", [ids.valeoA]);
  assert.equal((await store.loadProductImages(schema.pool, b)).hideAutomatic, false);
  assert.equal((await store.loadProductImages(schema.pool, a)).hideAutomatic, true);
  // After an admin change on the target, undoing the merge leaves the setting.
  await store.setAutomaticImageHidden(schema.pool, c, true, admin);
  await merge(c, d);
  assert.deepEqual(await upload(d, await solid(220), "depo.jpg"), { ok: true });
  await schema.pool.query("SELECT product_reset_item($1)", [ids.hellaA]);
  assert.equal((await store.loadProductImages(schema.pool, d)).hideAutomatic, true);
  assert.deepEqual(await fileNames(d), ["depo.jpg"]);
});

test("a merged product's uploads are served only through a product that is not merged", async () => {
  await item("swagA", { supplier: "basbug", code: "SWG 16016", brand: "SWAG", name: "SWAG ROT" });
  await item("swagB", { supplier: "basbug", code: "MEY 17017", brand: "MEYLE", name: "MEYLE ROT" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const a = await productOf("swagA"), b = await productOf("swagB");
  // Control characters do not reach the stored file name.
  assert.deepEqual(await upload(a, await solid(230), "swag\u0007\nön.jpg"), { ok: true });
  assert.deepEqual(await fileNames(a), ["swagön.jpg"]);
  const mediaId = (await store.loadProductImages(schema.pool, a)).images[0].src.split("/").pop()!;
  await merge(a, b);
  const [carried] = (await store.loadProductImages(schema.pool, b)).images;
  assert.ok(await images.servableProductMedia(mediaId, storefrontCompanies()));
  // Deleted on the kept product: A (merged) still has its row, but nothing shows it.
  assert.deepEqual(await store.removeProductImage(schema.pool, b, carried.id, admin), { ok: true });
  assert.equal(await images.servableProductMedia(mediaId, storefrontCompanies()), undefined);
  // A revived: its own upload is served again.
  await schema.pool.query("SELECT product_reset_item($1)", [ids.swagA]);
  assert.ok(await images.servableProductMedia(mediaId, storefrontCompanies()));
});

test("home rails count uploads and skip a hidden automatic image (#596)", async () => {
  const [home, epoch] = await Promise.all([import("../src/modules/store/home"), import("../src/modules/store/listing-epoch")]);
  await item("railAuto", { supplier: "basbug", code: "ATE 50050", brand: "ATE", name: "ATE FREN DISKI" });
  await item("railPlain", { supplier: "basbug", code: "VAL 60060", brand: "VALEO", name: "VALEO DEBRIYAJ" });
  await item("railHidden", { supplier: "basbug", code: "DEL 61061", brand: "DELPHI", name: "DELPHI POMPA" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const media = (await schema.pool.query<{ id: string }>(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url)
    VALUES('product-media','products/bb/rail.webp',$1,'image/webp',1000,'https://www.trodo.com/rail.webp') RETURNING id::text`,
  [createHash("sha256").update("rail-automatic").digest("hex")])).rows[0].id;
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,'ATE 50050','ATE','complete')`, [ids.railAuto]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload)
    VALUES($1,'ATE 50050','ATE','https://www.trodo.com/ate','test','ATE','50050',$2,'{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}')`, [ids.railAuto, media]);
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  const railAuto = await productOf("railAuto"), railPlain = await productOf("railPlain"), railHidden = await productOf("railHidden");
  const rail = async () => { await epoch.invalidateListings(); return (await home.getHomeProducts()).map(product => product.id); };

  // (a) A trusted automatic image puts the row on the rail; rows without any image stay off.
  let picked = await rail();
  assert.ok(picked.includes(ids.railAuto), "(a) automatic image");
  assert.ok(!picked.includes(ids.railPlain) && !picked.includes(ids.railHidden), "(a) no image");
  // (b) Hiding the automatic image takes it off; without a bump the cached pick is still served.
  assert.deepEqual(await store.setAutomaticImageHidden(schema.pool, railAuto, true, admin), { ok: true });
  assert.ok((await home.getHomeProducts()).some(product => product.id === ids.railAuto), "no bump: the cached pick is served");
  assert.ok(!(await rail()).includes(ids.railAuto), "(b) automatic image hidden");
  // (c) An upload brings it back while the automatic image stays hidden.
  assert.deepEqual(await upload(railAuto, await solid(150), "ate.jpg"), { ok: true });
  assert.ok((await rail()).includes(ids.railAuto), "(c) upload over a hidden automatic image");
  // (d) An upload on a product without any enrichment puts it on the rail, first (the newest image).
  assert.deepEqual(await upload(railPlain, await solid(151), "valeo.jpg"), { ok: true });
  picked = await rail();
  assert.equal(picked[0], ids.railPlain, "(d) the newest upload comes first");
  assert.equal(new Set(picked).size, picked.length, "a row in both arms is listed once");
  // (e) Deleting the upload takes it off again.
  const [plainImage] = (await store.loadProductImages(schema.pool, railPlain)).images;
  assert.deepEqual(await store.removeProductImage(schema.pool, railPlain, plainImage.id, admin), { ok: true });
  assert.ok(!(await rail()).includes(ids.railPlain), "(e) upload deleted");
  // (f) An admin-hidden product stays off even with an upload.
  assert.deepEqual(await upload(railHidden, await solid(152), "delphi.jpg"), { ok: true });
  assert.ok((await rail()).includes(ids.railHidden), "(f) upload");
  assert.ok((await overrides.persistProductOverride(schema.pool, railHidden, { hidden: true }, admin)).ok);
  assert.ok(!(await rail()).includes(ids.railHidden), "(f) product hidden");
});

test("the store shows an image: an upload, or the automatic image unless hidden (#596)", async () => {
  await item("shownA", { supplier: "basbug", code: "SHW 70001", brand: "SHOWN", name: "SHOWN A" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const product = await productOf("shownA");
  const shown = async (automatic: boolean) => (await schema.pool.query<{ shown: boolean; hidden: boolean; uploaded: boolean }>(
    `SELECT ${shownImageSql(itemProductSql("$1::uuid"), automatic ? "true" : "false")} AS shown,
      ${automaticImageHiddenSql("$2::uuid")} AS hidden,${uploadedImageSql("$2::uuid")} AS uploaded`, [ids.shownA, product])).rows[0];
  assert.deepEqual(await shown(false), { shown: false, hidden: false, uploaded: false }, "no image at all");
  assert.deepEqual(await shown(true), { shown: true, hidden: false, uploaded: false }, "automatic image");
  await store.setAutomaticImageHidden(schema.pool, product, true, admin);
  assert.deepEqual(await shown(true), { shown: false, hidden: true, uploaded: false }, "automatic image hidden");
  assert.deepEqual(await upload(product, await solid(160), "shown.jpg"), { ok: true });
  assert.deepEqual(await shown(true), { shown: true, hidden: true, uploaded: true }, "hidden automatic image and an upload");
  assert.deepEqual(await shown(false), { shown: true, hidden: true, uploaded: true }, "an upload alone");
  assert.deepEqual((await schema.pool.query<{ id: string }>(`${hiddenAutomaticItemsSql} AND ps.supplier_item_id=$1`, [ids.shownA])).rows.length, 1);
});

test("the admin image filters read the image the store shows (#596)", async () => {
  for (const file of ["src/modules/admin/manual.ts", "src/modules/admin/enrichment-data.ts"])
    assert.match(await readFile(file, "utf8"), /shownImageSql\(/, file);
});

test("setup can run the file again", async () => {
  await schema.pool.query(await readFile("db/product-override-images.sql", "utf8"));
  assert.equal((await schema.pool.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='product_override_images_products_restored'
    AND tgrelid=to_regclass($1)`, [`${schema.name}.products`])).rows[0].n, 1);
});
