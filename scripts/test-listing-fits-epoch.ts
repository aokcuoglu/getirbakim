import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";

// The fits epoch (#1368) in an isolated copy of the schema: the fit sync's bump (invalidateFits) moves only the value the
// caches that read vehicle fits follow (epoch+fits_epoch), an admin edit's (invalidateListings) moves both, and the
// guarded column is added once, continuing the scale of the stored rows. Nothing is written to the shared database.
type Epoch = typeof import("../src/modules/store/listing-epoch");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let epoch: Epoch;
let closeDb: () => Promise<void>;

/** The row as another process reads it: `epoch` and the fits value. */
const counters = async () => (await schema.pool.query<{ epoch: number; fits_epoch: number; fits: number }>(
  "SELECT epoch::int,fits_epoch::int,(epoch+fits_epoch)::int AS fits FROM storefront_listing_epoch")).rows[0];
const column = async () => (await schema.pool.query<{ attnum: number; notnull: boolean; fallback: string }>(
  `SELECT a.attnum,a.attnotnull AS notnull,pg_get_expr(d.adbin,d.adrelid) AS fallback FROM pg_attribute a
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='storefront_listing_epoch'::regclass AND a.attname='fits_epoch' AND NOT a.attisdropped`)).rows[0];
const applyOverrides = async () => schema.pool.query(await readFile("db/product-overrides.sql", "utf8"));
/** Another app process: a second copy of the module, with its own known values, on the same database. */
const otherProcess = async (name: string) => await import(`../src/modules/store/listing-epoch.ts?${name}`) as Epoch;

before(async () => {
  schema = await isolatedSchema("listing_fits_epoch_test");
  const [{ db }, epochModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/listing-epoch")]);
  epoch = epochModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("setup adds fits_epoch at 0, and applying the file again changes nothing", async () => {
  const added = await column();
  assert.deepEqual(added && { notnull: added.notnull, fallback: added.fallback }, { notnull: true, fallback: "0" });
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=3,fits_epoch=2");
  await applyOverrides();
  assert.deepEqual(await column(), added, "the same column");
  assert.deepEqual(await counters(), { epoch: 3, fits_epoch: 2, fits: 5 }, "the same values");
});

test("added to an existing row, the fits value starts at the epoch the stored rows carry", async () => {
  await schema.pool.query("ALTER TABLE storefront_listing_epoch DROP COLUMN fits_epoch");
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=7");
  await applyOverrides();
  assert.ok(await column());
  assert.deepEqual(await counters(), { epoch: 7, fits_epoch: 0, fits: 7 });
});

test("invalidateFits moves the fits value only; invalidateListings moves both; the fits value is never below the epoch", async () => {
  assert.deepEqual([await epoch.listingEpoch(), await epoch.fitsEpoch()], [7, 7]);
  await epoch.invalidateFits();
  assert.deepEqual([await epoch.listingEpoch(), await epoch.fitsEpoch()], [7, 8], "seen at once by the process that bumped");
  assert.deepEqual(await counters(), { epoch: 7, fits_epoch: 1, fits: 8 });
  await epoch.invalidateListings();
  assert.deepEqual([await epoch.listingEpoch(), await epoch.fitsEpoch()], [8, 9]);
  assert.deepEqual(await counters(), { epoch: 8, fits_epoch: 1, fits: 9 });
  // A raw bump (another task on the code before #1368) moves both values too.
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now()");
  const other = await otherProcess("other");
  assert.deepEqual([await other.listingEpoch(), await other.fitsEpoch()], [9, 10], "another process reads both");
  for (let bump = 0; bump < 5; bump++) {
    await (bump % 2 ? epoch.invalidateListings() : epoch.invalidateFits());
    const [listing, fits] = [await epoch.listingEpoch(), await epoch.fitsEpoch()];
    assert.ok(fits >= listing, `bump ${bump}: ${fits} >= ${listing}`);
  }
});

// Last: drops the column, as on a database whose setup has not run yet.
test("without the column both values read the epoch, both bumps move it, and nothing throws", async t => {
  await schema.pool.query("ALTER TABLE storefront_listing_epoch DROP COLUMN fits_epoch");
  const logged = t.mock.method(console, "error", () => {});
  const before = (await schema.pool.query<{ epoch: number }>("SELECT epoch::int FROM storefront_listing_epoch")).rows[0].epoch;
  await epoch.invalidateFits();
  await epoch.invalidateListings();
  const after = (await schema.pool.query<{ epoch: number }>("SELECT epoch::int FROM storefront_listing_epoch")).rows[0].epoch;
  assert.equal(after, before + 2, "each bump moved the epoch once");
  assert.equal(await epoch.listingEpoch(), after);
  assert.ok(await epoch.fitsEpoch() >= after);
  // A process that never saw the column: both values are the epoch.
  const fresh = await otherProcess("legacy");
  assert.deepEqual([await fresh.listingEpoch(), await fresh.fitsEpoch()], [after, after]);
  await fresh.invalidateFits();
  assert.deepEqual([await fresh.listingEpoch(), await fresh.fitsEpoch()], [after + 1, after + 1]);
  const messages = logged.mock.calls.map(call => String(call.arguments[0]));
  assert.deepEqual(messages, Array(2).fill("Listing epoch: fits_epoch is missing (setup not run yet); the fit caches follow the listing epoch for 5 minutes"),
    "once per process");
});
