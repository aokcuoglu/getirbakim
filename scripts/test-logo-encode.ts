import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { fitLogo, logoBoxes } from "../src/modules/store/logo-encode";
import { readLogoPng } from "../src/modules/store/manufacturer-logo-import";

const box = logoBoxes.manufacturer;
const solid = (width: number, height: number, format: "webp" | "png", alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha } } })[format]().toBuffer();

test("oversize logo is fitted inside the box keeping its ratio", async () => {
  const out = await fitLogo(await solid(480, 120, "webp"), box, "webp");
  assert.equal(out.changed, true);
  assert.deepEqual([out.width, out.height], [240, 60]);
  const meta = await sharp(out.bytes).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [240, 60, "webp"]);
});

test("logo already inside the box is returned untouched and never enlarged", async () => {
  const input = await solid(100, 40, "webp");
  const out = await fitLogo(input, box, "webp");
  assert.equal(out.changed, false);
  assert(out.bytes.equals(input));
  assert.deepEqual([out.width, out.height], [100, 40]);
});

test("a re-encode that would be larger keeps the input untouched", async () => {
  // A 2-colour palette PNG is tiny; the resized full-colour re-encode is bigger.
  const stripes = Buffer.alloc(260 * 130 * 3);
  for (let i = 0; i < stripes.length; i++) stripes[i] = Math.floor(i / 3 / 4) % 2 ? 255 : 0;
  const input = await sharp(stripes, { raw: { width: 260, height: 130, channels: 3 } }).png({ palette: true, colours: 2 }).toBuffer();
  const out = await fitLogo(input, box, "png");
  assert.equal(out.changed, false);
  assert(out.bytes.equals(input));
  assert.deepEqual([out.width, out.height], [260, 130]);
});

test("an oversized photo-like logo still shrinks", async () => {
  const noise = Buffer.alloc(800 * 400 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + (i >> 3) * 104729) & 255;
  const input = await sharp(noise, { raw: { width: 800, height: 400, channels: 3 } }).png().toBuffer();
  const out = await fitLogo(input, box, "png");
  assert.equal(out.changed, true);
  assert(out.bytes.length < input.length);
  assert(out.width <= box.width && out.height <= box.height);
});

test("a second pass is idempotent", async () => {
  const first = await fitLogo(await solid(600, 300, "webp"), box, "webp");
  const second = await fitLogo(first.bytes, box, "webp");
  assert.equal(second.changed, false);
  assert(second.bytes.equals(first.bytes));
  assert.equal(second.sha256, first.sha256);
});

test("alpha survives the resize", async () => {
  const out = await fitLogo(await solid(480, 200, "png", 0.5), box, "webp");
  const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert(data[3] > 100 && data[3] < 155);
});

test("png in, png out passes readLogoPng and the sha256 matches", async () => {
  const out = await fitLogo(await solid(480, 200, "png"), box, "png");
  const parsed = readLogoPng(out.bytes);
  assert.deepEqual([parsed.width, parsed.height], [out.width, out.height]);
  assert.equal(out.sha256, createHash("sha256").update(out.bytes).digest("hex"));
  assert.equal(parsed.sha256, out.sha256);
});

test("brand-logos registry files exist, match their entries and fit the 2x boxes", async () => {
  const registry = JSON.parse(readFileSync("data/brand-logos.json", "utf8")) as Record<"vehicles" | "manufacturers", Record<string, { src: string; width: number; height: number; sha256: string }>>;
  for (const [set, limit] of [["vehicles", logoBoxes.vehicle], ["manufacturers", logoBoxes.manufacturer]] as const) {
    for (const [name, entry] of Object.entries(registry[set])) {
      const bytes = readFileSync(`public${entry.src}`);
      const meta = await sharp(bytes).metadata();
      assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `${set}/${name} sha256`);
      assert.deepEqual([meta.width, meta.height], [entry.width, entry.height], `${set}/${name} size`);
      assert(entry.width <= limit.width && entry.height <= limit.height, `${set}/${name} inside box`);
    }
  }
});
