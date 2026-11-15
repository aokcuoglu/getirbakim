import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { isolatedSchema } from "./isolated-schema";

// The kit's product query runs against the real commerce_catalog shape (#677: it read a column only the storefront
// listing has, and /bakim-robotu failed for every visitor).
test("the maintenance kit's product query runs on the commerce catalog", async () => {
  const schema = await isolatedSchema("kit_query_test");
  try {
    const { sellableProducts } = await import("../src/modules/store/maintenance-kit.server");
    assert.deepEqual(await sellableProducts([randomUUID()]), []);
    assert.deepEqual(await sellableProducts([]), []);
  } finally {
    const { db } = await import("../src/lib/db");
    await db.end();
    await schema.drop();
  }
});
