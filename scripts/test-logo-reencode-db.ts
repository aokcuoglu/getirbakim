import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { logoCacheControl } from "../src/modules/store/manufacturer-logo-cache";
import { assertApplyAllowed, describeDatabase, updateLogoRow } from "./reencode-logos";
import { isolatedSchema } from "./isolated-schema";

// updateLogoRow's old-sha guard runs in an isolated copy of the schema; nothing touches the shared tables.

describe("logoCacheControl", () => {
  const sha = "a".repeat(64);
  test("matching version is immutable; stale, garbage or missing version is cached for an hour", () => {
    assert.equal(logoCacheControl(sha, sha), "public, max-age=31536000, immutable");
    assert.equal(logoCacheControl("b".repeat(64), sha), "public, max-age=3600");
    assert.equal(logoCacheControl("garbage", sha), "public, max-age=3600");
    assert.equal(logoCacheControl(null, sha), "public, max-age=3600");
  });
});

describe("reencode-logos safety", () => {
  test("describeDatabase hides the password and requires DATABASE_URL", () => {
    assert.deepEqual(describeDatabase("postgres://app:secret@db.example:5432/shop"), { host: "db.example:5432", port: "5432", user: "app", name: "shop" });
    assert.throws(() => describeDatabase(undefined), /DATABASE_URL/);
  });
  test("--apply is refused on the prod tunnel and non-default ports without --yes-remote", () => {
    assert.doesNotThrow(() => assertApplyAllowed("5432", false));
    assert.throws(() => assertApplyAllowed("15432", false));
    assert.throws(() => assertApplyAllowed("6543", false), /--yes-remote/);
    assert.doesNotThrow(() => assertApplyAllowed("6543", true));
  });
});

describe("updateLogoRow", () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  before(async () => { schema = await isolatedSchema("logo_reencode"); });
  after(async () => { await schema.drop(); });

  test("updates with the right sha and touches nothing with a wrong one", async () => {
    const oldSha = "c".repeat(64);
    const big = await sharp({ create: { width: 360, height: 180, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).png().toBuffer();
    await schema.pool.query(
      "INSERT INTO manufacturer_logos(brand_key,manufacturer,image_data,sha256,width,height,source_url,evidence_source_url) VALUES('TEST','Test',$1,$2,360,180,'https://x.test','https://x.test')",
      [big, oldSha]);
    const small = await sharp(big).resize(240, 100, { fit: "inside" }).png().toBuffer();
    const row = { brandKey: "TEST", bytes: small, sha256: "d".repeat(64), width: 240, height: 100 };
    const client = await schema.pool.connect();
    try {
      assert.equal(await updateLogoRow(client, { ...row, oldSha256: "e".repeat(64) }), 0);
      assert.equal(await updateLogoRow(client, { ...row, oldSha256: oldSha }), 1);
      assert.equal(await updateLogoRow(client, { ...row, oldSha256: oldSha }), 0);
    } finally { client.release(); }
    const stored = (await schema.pool.query("SELECT width,height,sha256 FROM manufacturer_logos WHERE brand_key='TEST'")).rows[0];
    assert.deepEqual(stored, { width: 240, height: 100, sha256: "d".repeat(64) });
  });
});
