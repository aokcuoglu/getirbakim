import assert from "node:assert/strict";
import test from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { compressedJson, pickEncoding } from "../src/lib/compressed-json";

const big = { groups: Array.from({ length: 200 }, (_, i) => ({ name: `Araç ${i}`, years: "2010-2020" })) };
const req = (encoding?: string) => new Request("http://x/api", encoding ? { headers: { "Accept-Encoding": encoding } } : {});

test("pickEncoding prefers br, honours q=0 and wildcard", () => {
  assert.equal(pickEncoding(null), null);
  assert.equal(pickEncoding("gzip, deflate, br"), "br");
  assert.equal(pickEncoding("gzip"), "gzip");
  assert.equal(pickEncoding("br;q=0, gzip"), "gzip");
  assert.equal(pickEncoding("gzip;q=0"), null);
  assert.equal(pickEncoding("*"), "br");
  assert.equal(pickEncoding("identity"), null);
});

test("compresses with brotli and gzip, keeps headers", async () => {
  const text = JSON.stringify(big);
  const br = compressedJson(req("br, gzip"), big, { headers: { "Cache-Control": "public, max-age=60" } });
  assert.equal(br.headers.get("Content-Encoding"), "br");
  assert.equal(br.headers.get("Vary"), "Accept-Encoding");
  assert.equal(br.headers.get("Cache-Control"), "public, max-age=60");
  assert.equal(br.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(br.headers.get("Set-Cookie"), null);
  assert.equal(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString(), text);
  const gz = compressedJson(req("gzip"), big);
  assert.equal(gz.headers.get("Content-Encoding"), "gzip");
  assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString(), text);
});

test("raw without Accept-Encoding, for small bodies and errors; Vary always set", async () => {
  const raw = compressedJson(req(), big);
  assert.equal(raw.headers.get("Content-Encoding"), null);
  assert.equal(raw.headers.get("Vary"), "Accept-Encoding");
  assert.deepEqual(await raw.json(), big);
  const small = compressedJson(req("gzip"), { ok: true });
  assert.equal(small.headers.get("Content-Encoding"), null);
  const err = compressedJson(req("gzip"), big, { status: 500 });
  assert.equal(err.headers.get("Content-Encoding"), null);
  assert.equal(err.status, 500);
});
