import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, mock, test } from "node:test";
import sharp from "sharp";
import { BrandLogoError, prepareBrandLogo, type BrandLogoErrorReason } from "../src/modules/admin/brand-logo-upload";
import { manufacturerBrandKey } from "../src/modules/store/enrichment-contract";
import { isolatedSchema } from "./isolated-schema";

// Admin brand logos (#819): the conversion every logo goes through (always WebP, SVG rasterised), then the store's
// resolution rule and the admin list's logo filter in an isolated copy of the schema. Nothing is written to the shared
// database's tables.

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 80, b: 160, alpha: 1 } } });
// A coloured mark on a transparent canvas, so trimming has a border to cut.
const framed = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.floor(width / 2), height: Math.floor(height / 2), channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }, gravity: "center" }]);
const isWebp = (bytes: Buffer) => bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";

async function rejects(promise: Promise<unknown>, reason: BrandLogoErrorReason) {
  await assert.rejects(promise, (error: unknown) => error instanceof BrandLogoError && error.reason === reason);
}

describe("prepareBrandLogo", () => {
  test("converts PNG, JPEG and WebP to WebP inside 640×288, trimmed, transparency kept", async () => {
    for (const input of [await framed(2000, 800).png().toBuffer(), await solid(1200, 300).jpeg().toBuffer(), await framed(400, 100).webp().toBuffer()]) {
      const logo = await prepareBrandLogo(input);
      assert.ok(isWebp(logo.bytes));
      assert.ok(logo.width <= 640 && logo.height <= 288, `${logo.width}×${logo.height}`);
      const meta = await sharp(logo.bytes).metadata();
      assert.deepEqual([meta.format, meta.width, meta.height], ["webp", logo.width, logo.height]);
      assert.equal(logo.sha256, createHash("sha256").update(logo.bytes).digest("hex"));
    }
    // The 2000×800 canvas's mark is 1000×400: trimmed, then fitted (640×256).
    const trimmed = await prepareBrandLogo(await framed(2000, 800).png().toBuffer());
    assert.deepEqual([trimmed.width, trimmed.height], [640, 256]);
    // Two marks with a transparent gap: the gap stays transparent.
    const mark = { create: { width: 50, height: 50, channels: 4 as const, background: { r: 200, g: 0, b: 0, alpha: 1 } } };
    const gapped = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, left: 10, top: 25 }, { input: mark, left: 340, top: 25 }]).png().toBuffer();
    const kept = await prepareBrandLogo(gapped);
    assert.deepEqual([kept.width, kept.height], [380, 50]);
    assert.equal((await sharp(kept.bytes).metadata()).hasAlpha, true);
    // Small logos are not enlarged.
    const small = await prepareBrandLogo(await solid(120, 40).png().toBuffer());
    assert.deepEqual([small.width, small.height], [120, 40]);
  });
  test("rasterises SVG to fill the box; scripts and handlers never reach the output", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" onload="alert(1)">
      <script>alert(1)</script><rect width="100" height="20" fill="#c00"/></svg>`);
    const logo = await prepareBrandLogo(svg);
    assert.ok(isWebp(logo.bytes));
    assert.deepEqual([logo.width, logo.height], [640, 128]);
    assert.ok(!logo.bytes.includes(Buffer.from("script")) && !logo.bytes.includes(Buffer.from("onload")));
  });
  test("refuses files over 1 MB", async () => {
    await rejects(prepareBrandLogo(Buffer.alloc(1024 * 1024 + 1)), "size");
    await rejects(prepareBrandLogo(Buffer.alloc(0)), "size");
  });
  test("refuses GIF, multi-frame images and non-images", async () => {
    await rejects(prepareBrandLogo(await solid(40, 40).gif().toBuffer()), "type");
    const frames = [await solid(40, 40).png().toBuffer(), await framed(40, 40).png().toBuffer()];
    await rejects(prepareBrandLogo(await sharp(frames, { join: { animated: true } }).webp().toBuffer()), "type");
    await rejects(prepareBrandLogo(Buffer.from("<!doctype html><html><body>logo</body></html>")), "unreadable");
  });
  test("refuses a huge SVG canvas and a tiny image", async () => {
    await rejects(prepareBrandLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="10" height="10"/></svg>')), "dimensions");
    await rejects(prepareBrandLogo(await solid(10, 10).png().toBuffer()), "dimensions");
  });
  test("refuses SVG that would be slow to render before rendering it", async () => {
    // 16 levels of a group drawing the previous one twice: 2^16 rectangles, each blurred, in about 2 KB.
    const levels = Array.from({ length: 16 }, (_, index) =>
      `<g id="l${index + 1}"><use href="#l${index}"/><use href="#l${index}" x="1"/></g>`).join("");
    const bomb = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><defs><filter id="f"><feGaussianBlur stdDeviation="9"/></filter>
      <rect id="l0" width="1" height="1" filter="url(#f)"/>${levels}</defs><use href="#l16"/></svg>`);
    const started = Date.now();
    await rejects(prepareBrandLogo(bomb), "complex");
    await rejects(prepareBrandLogo(Buffer.from(bomb.toString().replace(/<filter[^]*?<\/filter>/, "").replace(' filter="url(#f)"', ""))), "complex");
    const many = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">${"<rect width=\"1\" height=\"1\"/>".repeat(3001)}</svg>`;
    await rejects(prepareBrandLogo(Buffer.from(many)), "complex");
    await rejects(prepareBrandLogo(Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>')), "complex");
    // 14 masks, each nested in the previous: no <use>, no filter.
    const masks = Array.from({ length: 14 }, (_, index) => `<mask id="m${index}"><rect width="200" height="50" fill="#fff" mask="url(#m${index + 1})"/>`).join("") + "</mask>".repeat(14);
    await rejects(prepareBrandLogo(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><defs>${masks}</defs><rect width="200" height="50" mask="url(#m0)"/></svg>`)), "complex");
    const patterns = '<pattern id="p0" width="2" height="2"><pattern id="p1" width="1" height="1"><rect width="1" height="1"/></pattern></pattern>';
    await rejects(prepareBrandLogo(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><defs>${patterns}</defs><rect width="200" height="50" fill="url(#p0)"/></svg>`)), "complex");
    const references = Array.from({ length: 9 }, (_, index) => `<rect x="${index}" width="1" height="1" fill="url(#g)"/>`).join("");
    await rejects(prepareBrandLogo(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><defs><linearGradient id="g"/></defs>${references}</svg>`)), "complex");
    // Sibling clip paths and a few references are fine.
    const fine = await prepareBrandLogo(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><defs><clipPath id="a"><rect width="100" height="50"/></clipPath>
      <clipPath id="b"><rect x="100" width="100" height="50"/></clipPath></defs><rect width="200" height="50" fill="#c00" clip-path="url(#a)"/><rect width="200" height="50" fill="#00c" clip-path="url(#b)"/></svg>`));
    assert.ok(isWebp(fine.bytes));
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  });
  test("refuses SVG with live text and logos that come out empty", async () => {
    await rejects(prepareBrandLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><text x="0" y="15">BOSCH</text></svg>')), "text");
    await rejects(prepareBrandLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><text><tspan>A</tspan></text></svg>')), "text");
    await rejects(prepareBrandLogo(await sharp({ create: { width: 100, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()), "empty");
  });
});

describe("store resolution and admin list", () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  let logos: typeof import("../src/modules/store/manufacturer-logos");
  let logoStore: typeof import("../src/modules/admin/brand-logo-store");
  let matching: typeof import("../src/modules/admin/product-matching");
  let closeDb: () => Promise<void>;
  let admin = "";
  const brands: Record<string, string> = {};
  let logoPng: Buffer;

  const enrichment = async (name: string, shade: number) => {
    const bytes = await solid(80 + shade, 20).png().toBuffer();
    const sha = createHash("sha256").update(bytes).digest("hex");
    await schema.pool.query(`INSERT INTO manufacturer_logos(brand_key,manufacturer,image_data,sha256,width,height,source_url,evidence_source_url)
      VALUES($1,$2,$3,$4,80,20,'https://example.com/l.png','https://example.com/p') ON CONFLICT(brand_key) DO UPDATE SET image_data=EXCLUDED.image_data,
      sha256=EXCLUDED.sha256,imported_at=now()`, [manufacturerBrandKey(name), name, bytes, sha]);
    return sha;
  };
  const brand = async (key: string, name: string, labels: [string, string, number][]) => {
    const id = (await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$2) RETURNING id::text", [key, name])).rows[0].id;
    for (const [supplier, label, items] of labels) await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES($1,$2,$3,$4)", [supplier, label, id, items]);
    brands[key] = id;
    return id;
  };
  const resolve = async (labels: string[]) => Object.fromEntries((await logos.getManufacturerLogos(labels)).entries());

  before(async () => {
    schema = await isolatedSchema("brand_logos_test");
    admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
      VALUES('A','logos@example.invalid','x','admin',true) RETURNING id`)).rows[0].id;
    // BOSCH has a static logo; KORJAP and WAGENBURG enrichment logos under one spelling; NOLOGO none.
    await brand("BOSCH", "BOSCH", [["basbug", "BOSCH", 70], ["dinamik", "BOSCH AV", 60]]);
    await brand("KORJAP", "KORJAP", [["basbug", "KORJAP", 50], ["dinamik", "KOR-JAP", 30]]);
    await brand("WAGENBURG", "WAGENBURG", [["dinamik", "WAGEN BURG AV", 40]]);
    await brand("NOLOGO", "NOLOGO", [["basbug", "NOLOGO", 90]]);
    await brand("TINY", "TINY", [["basbug", "TINY", 5]]);
    await enrichment("KORJAP", 0);
    await enrichment("WAGENBURG", 1);
    logoPng = await framed(400, 100).png().toBuffer();
    mock.module("../src/modules/auth/session.ts", { namedExports: { requireAdmin: async () => ({ id: admin }) } });
    const [{ db }, logosModule, storeModule, matchingModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/manufacturer-logos"),
      import("../src/modules/admin/brand-logo-store"), import("../src/modules/admin/product-matching")]);
    logos = logosModule;
    logoStore = storeModule;
    matching = matchingModule;
    closeDb = () => db.end();
  });
  after(async () => { await closeDb?.(); await schema?.drop(); });

  test("automatic logos: static first, then enrichment; every spelling of a brand gets the same logo", async () => {
    const found = await resolve(["BOSCH AV", "KOR-JAP", "WAGEN BURG AV", "WAGENBURG", "NOLOGO"]);
    assert.match(found["BOSCH AV"].src, /^\/media\/logos\/manufacturers\/bosch\.webp\?v=/);
    assert.match(found["KOR-JAP"].src, /^\/api\/manufacturer-logos\/KORJAP\?v=/);
    assert.equal(found["WAGEN BURG AV"].src, found.WAGENBURG.src);
    assert.equal(found.NOLOGO, undefined);
  });
  test("a label no master brand knows tries its own spelling only", async () => {
    const found = await resolve(["SACHS", "UNKNOWN"]);
    assert.match(found.SACHS.src, /^\/media\/logos\/manufacturers\/sachs\.webp/);
    assert.equal(found.UNKNOWN, undefined);
  });
  test("pickAutomaticLogo tries each candidate's static logo, then its enrichment logo", () => {
    const byKey = new Map([["B", { brand_key: "B", sha256: "b".repeat(64), width: 10, height: 5 }]]);
    const lookup = (name: string) => name === "C" ? { src: "/c.webp", width: 1, height: 1 } : undefined;
    assert.equal(logos.pickAutomaticLogo(["A", "B", "C"], lookup, byKey)?.source, "enrichment");
    assert.equal(logos.pickAutomaticLogo(["A", "C", "B"], lookup, byKey)?.source, "static");
    assert.equal(logos.pickAutomaticLogo(["A"], lookup, byKey), null);
  });
  test("the admin's logo beats static and enrichment; later enrichment imports do not touch it", async () => {
    assert.deepEqual(await logoStore.setBrandLogo(schema.pool, brands.BOSCH, { bytes: logoPng, name: "bosch.png" }, admin), { ok: true });
    assert.deepEqual(await logoStore.setBrandLogo(schema.pool, brands.KORJAP, { bytes: logoPng, name: "c:\\x\\korjap.png", sourceUrl: "https://example.com/k.svg" }, admin), { ok: true });
    const stored = (await schema.pool.query<{ sha256: string; file_name: string; source_url: string }>("SELECT sha256,file_name,source_url FROM brand_logos WHERE brand_id=$1", [brands.KORJAP])).rows[0];
    assert.deepEqual([stored.file_name, stored.source_url], ["korjap.png", "https://example.com/k.svg"]);
    await enrichment("KORJAP", 7);
    const found = await resolve(["BOSCH", "BOSCH AV", "KOR-JAP"]);
    assert.equal(found.BOSCH.src, `/api/brand-logos/${brands.BOSCH}?v=${stored.sha256}`);
    assert.equal(found["BOSCH AV"].src, found.BOSCH.src);
    assert.equal(found["KOR-JAP"].src, `/api/brand-logos/${brands.KORJAP}?v=${stored.sha256}`);
  });
  test("a rejected file or a missing brand changes nothing", async () => {
    assert.deepEqual(await logoStore.setBrandLogo(schema.pool, brands.NOLOGO, { bytes: Buffer.from("nope"), name: "x.png" }, admin), { ok: false, reason: "image", image: "unreadable" });
    assert.deepEqual(await logoStore.setBrandLogo(schema.pool, "999999", { bytes: logoPng, name: "x.png" }, admin), { ok: false, reason: "not-found" });
    assert.deepEqual(await logoStore.hideBrandLogo(schema.pool, "999999", admin), { ok: false, reason: "not-found" });
    assert.equal((await schema.pool.query("SELECT 1 FROM brand_logos WHERE brand_id=$1", [brands.NOLOGO])).rowCount, 0);
  });
  test("hiding shows no logo at all; reverting brings the automatic one back", async () => {
    assert.deepEqual(await logoStore.hideBrandLogo(schema.pool, brands.BOSCH, admin), { ok: true });
    assert.deepEqual(await resolve(["BOSCH", "BOSCH AV"]), {});
    const panel = await logos.resolveBrandLogos([{ id: brands.BOSCH, name: "BOSCH", labels: ["BOSCH", "BOSCH AV"] }]);
    assert.deepEqual(panel.get(brands.BOSCH), { logo: null, source: "hidden", automatic: true });
    assert.deepEqual(await logoStore.resetBrandLogo(schema.pool, brands.BOSCH), { ok: true });
    assert.match((await resolve(["BOSCH AV"]))["BOSCH AV"].src, /^\/media\/logos\/manufacturers\/bosch\.webp/);
    assert.equal((await logos.resolveBrandLogos([{ id: brands.BOSCH, name: "BOSCH", labels: [] }])).get(brands.BOSCH)?.source, "static");
  });
  test("admin list: the logo filter lists brands without a logo, largest first, with their count", async () => {
    const missing = await matching.productMatchingData({ tab: "brands", logo: "missing" });
    assert.ok("brands" in missing);
    assert.equal(missing.scope, "all");
    assert.deepEqual(missing.brands.map(row => row.name), ["NOLOGO", "TINY"]);
    assert.equal(missing.logoMissing, 2);
    // The option's count follows the search and scope.
    const searched = await matching.productMatchingData({ tab: "brands", scope: "all", q: "tiny" });
    assert.ok("brands" in searched);
    assert.equal(searched.logoMissing, 1);
    assert.equal(missing.total, 2);
    assert.ok(missing.brands.every(row => row.logo === null && row.logoSource === null));
    const present = await matching.productMatchingData({ tab: "brands", logo: "present" });
    assert.ok("brands" in present);
    assert.deepEqual(present.brands.map(row => [row.name, row.logoSource]), [["BOSCH", "static"], ["KORJAP", "manual"], ["WAGENBURG", "enrichment"]]);
    const all = await matching.productMatchingData({ tab: "brands", scope: "all" });
    assert.ok("brands" in all);
    assert.equal(all.total, 5);
  });
  test("brand_merge moves the admin's logo unless the target has its own; deleting a brand drops it", async () => {
    // KORJAP (manual) into NOLOGO (none): the logo moves.
    await schema.pool.query("SELECT brand_merge($1,$2,$3)", [brands.KORJAP, brands.NOLOGO, admin]);
    const sha = (id: string) => schema.pool.query<{ sha256: string | null }>("SELECT sha256 FROM brand_logos WHERE brand_id=$1", [id]).then(result => result.rows[0]?.sha256);
    const moved = await sha(brands.NOLOGO);
    assert.ok(moved);
    assert.match((await resolve(["KOR-JAP"]))["KOR-JAP"].src, new RegExp(`^/api/brand-logos/${brands.NOLOGO}\\?v=${moved}$`));
    // TINY (manual, other file) into NOLOGO (manual): the target keeps its own.
    await logoStore.setBrandLogo(schema.pool, brands.TINY, { bytes: await solid(300, 60).png().toBuffer(), name: "tiny.png" }, admin);
    await schema.pool.query("SELECT brand_merge($1,$2,$3)", [brands.TINY, brands.NOLOGO, admin]);
    assert.equal(await sha(brands.NOLOGO), moved);
    assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM brand_logos WHERE brand_id=$1", [brands.TINY])).rows[0].n, 0);
    // A real logo replaces a target that only hides its logo.
    const hidden = await brand("HIDDEN", "HIDDEN", [["seta", "HIDDEN", 1]]);
    await logoStore.hideBrandLogo(schema.pool, hidden, admin);
    await schema.pool.query("SELECT brand_merge($1,$2,$3)", [brands.NOLOGO, hidden, admin]);
    assert.equal(await sha(hidden), moved);
    brands.NOLOGO = hidden;
    await schema.pool.query("DELETE FROM supplier_brands WHERE brand_id=$1", [brands.NOLOGO]);
    await schema.pool.query("DELETE FROM brands WHERE id=$1", [brands.NOLOGO]);
    assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM brand_logos WHERE brand_id=$1", [brands.NOLOGO])).rows[0].n, 0);
  });
  test("the table refuses half-filled rows", async () => {
    await assert.rejects(schema.pool.query("INSERT INTO brand_logos(brand_id,image_data) VALUES($1,'\\x00')", [brands.WAGENBURG]));
  });
});
