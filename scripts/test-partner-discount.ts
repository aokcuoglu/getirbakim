import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";

// The /yonetim/partnerler discount action (#1130) in an isolated copy of the schema: admin first, validation, known
// partners only, and the audit row naming the admin. Pricing with the discount is covered in scripts/test-partner-orders.ts.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let actions: typeof import("../src/modules/admin/partner-actions");
let closeDb: () => Promise<void>;
let admin = "";
// null = not signed in as an admin: requireAdmin redirects (throws) like the real one.
let signedIn: string | null = null;
const originalKeys = process.env.PARTNER_API_KEYS;

mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("../src/modules/auth/session.ts", { namedExports: { requireAdmin: async () => {
  if (!signedIn) throw new Error("NEXT_REDIRECT /giris");
  return { id: signedIn };
} } });

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const settings = async () => (await schema.pool.query<{ partner_code: string; discount_bps: number | null; updated_by: string | null }>(
  "SELECT partner_code,discount_bps,updated_by::text FROM partner_settings ORDER BY partner_code")).rows;
const changes = async () => (await schema.pool.query<{ partner_code: string; old_discount_bps: number | null; new_discount_bps: number | null; changed_by: string | null }>(
  "SELECT partner_code,old_discount_bps,new_discount_bps,changed_by::text FROM partner_discount_changes ORDER BY id")).rows;

before(async () => {
  schema = await isolatedSchema("partner_discount_test");
  process.env.PARTNER_API_KEYS = `bakimx:${"k".repeat(24)}`;
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Admin','discount@example.invalid','x','admin',true) RETURNING id::text`)).rows[0].id;
  const [{ db }, actionsModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/admin/partner-actions")]);
  actions = actionsModule;
  closeDb = () => db.end();
});
beforeEach(async () => {
  signedIn = null;
  await schema.pool.query("DELETE FROM partner_settings; DELETE FROM partner_discount_changes");
});
after(async () => {
  if (originalKeys === undefined) delete process.env.PARTNER_API_KEYS; else process.env.PARTNER_API_KEYS = originalKeys;
  await closeDb?.(); await schema?.drop();
});

test("the discount action needs an admin before it reads or writes anything", async () => {
  await assert.rejects(actions.savePartnerDiscountRate(form({ partner: "bakimx", discount: "10" })), /NEXT_REDIRECT \/giris/);
  assert.deepEqual(await settings(), []);
  assert.deepEqual(await changes(), []);
});

test("an admin saves a percent as basis points with an audit row; empty clears it", async () => {
  signedIn = admin;
  await assert.rejects(actions.savePartnerDiscountRate(form({ partner: "bakimx", discount: "12,5" })), /NEXT_REDIRECT \/yonetim\/partnerler\?discount=bakimx$/);
  assert.deepEqual(await settings(), [{ partner_code: "bakimx", discount_bps: 1250, updated_by: admin }]);
  await assert.rejects(actions.savePartnerDiscountRate(form({ partner: "bakimx", discount: "" })), /discount=bakimx$/);
  assert.equal((await settings())[0].discount_bps, null);
  assert.deepEqual(await changes(), [
    { partner_code: "bakimx", old_discount_bps: null, new_discount_bps: 1250, changed_by: admin },
    { partner_code: "bakimx", old_discount_bps: 1250, new_discount_bps: null, changed_by: admin },
  ]);
});

test("an invalid rate or an unknown partner is refused without a write", async () => {
  signedIn = admin;
  await assert.rejects(actions.savePartnerDiscountRate(form({ partner: "bakimx", discount: "95" })), /NEXT_REDIRECT \/yonetim\/partnerler\?error=discount&partner=bakimx$/);
  await assert.rejects(actions.savePartnerDiscountRate(form({ partner: "bakimx", discount: "abc" })), /error=discount&partner=bakimx$/);
  // An unknown code is not echoed back.
  await assert.rejects(actions.savePartnerDiscountRate(form({ partner: "stranger", discount: "10" })), /NEXT_REDIRECT \/yonetim\/partnerler\?error=discount$/);
  assert.deepEqual(await settings(), []);
  assert.deepEqual(await changes(), []);
});
