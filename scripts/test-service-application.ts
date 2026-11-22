import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { serviceUpgradeSchema } from "../src/modules/auth/schemas";
import { isolatedSchema } from "./isolated-schema";

// Service applications (#1259): a signed-in individual customer asks for the same account to become a service account,
// an admin approves (role change with the requested details) or rejects it, and the guest form points an existing
// customer to its account. Runs against an isolated schema; cookies are an in-memory jar. currentAccount() is React
// cache()d, so every test signs in with its own session token.
const cookieStore = new Map<string, string>();
const jar = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
  set: (name: string, value: string) => { cookieStore.set(name, value); },
  delete: (name: string) => { cookieStore.delete(name); },
};
mock.module("next/headers", { namedExports: { cookies: async () => jar, headers: async () => new Headers() } });
mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });

const details = { name: "Yılmaz Oto Servis", contactName: "Ayşe Yılmaz", city: "Kadıköy / İstanbul", phone: "0532 111 22 33", terms: "on" };

test("the upgrade schema keeps only the service details and refuses a bad phone or missing terms", () => {
  const parsed = serviceUpgradeSchema.parse({ ...details, email: "x@example.invalid", password: "uzun-bir-sifre-123", website: "spam", role: "admin", approved: "true", discount_percent: "50" });
  assert.deepEqual(parsed, details);
  assert.equal(serviceUpgradeSchema.safeParse({ ...details, phone: "123" }).success, false);
  assert.equal(serviceUpgradeSchema.safeParse({ ...details, phone: "+90 532 111 22 33 44 55 66" }).success, false);
  assert.equal(serviceUpgradeSchema.safeParse({ ...details, terms: undefined }).success, false);
});

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let application: typeof import("../src/modules/auth/service-application");
let services: typeof import("../src/modules/admin/service-accounts");
let adminActions: typeof import("../src/modules/admin/actions");
let session: typeof import("../src/modules/auth/session");
let adminData: typeof import("../src/modules/admin/data");
let closeDb: () => Promise<void>;
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const redirected = async (action: Promise<unknown>) => {
  try { await action; } catch (error) { const match = /^NEXT_REDIRECT (.*)$/.exec((error as Error).message); if (match) return match[1]; throw error; }
  assert.fail("expected a redirect");
};
type Row = { id: string; name: string; email: string; role: string; approved: boolean; discount_percent: number; contact_name: string; phone: string; city: string; password_hash: string };
const account = async (email: string) => (await schema.pool.query<Row>(
  "SELECT id,name,email,role,approved,discount_percent,contact_name,phone,city,password_hash FROM accounts WHERE email=$1", [email])).rows[0];
const request = async (id: string) => (await schema.pool.query<{ service_name: string; contact_name: string; phone: string; city: string; created_at: Date }>(
  "SELECT service_name,contact_name,phone,city,created_at FROM service_upgrade_requests WHERE account_id=$1", [id])).rows[0];
const create = async (email: string, role: "customer" | "service" | "admin", approved = true) => (await schema.pool.query<{ id: string }>(
  "INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Önceki Ad',$1,'eski-hash',$2,$3) RETURNING id", [email, role, approved])).rows[0].id;
// Signs `id` in with a fresh token (a new cache key for currentAccount) and returns the token.
const signIn = async (id: string) => {
  const token = randomUUID();
  await schema.pool.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash("sha256").update(token).digest("hex"), id]);
  cookieStore.set("gb_session", token);
  return token;
};
const upgrade = (fields: Record<string, string> = {}) => redirected(application.applyForServiceUpgrade(form({ ...details, ...fields })));

before(async () => {
  schema = await isolatedSchema("service_application_test");
  const [{ db }, app, svc, actions, auth] = await Promise.all([import("../src/lib/db"), import("../src/modules/auth/service-application"),
    import("../src/modules/admin/service-accounts"), import("../src/modules/admin/actions"), import("../src/modules/auth/session")]);
  application = app; services = svc; adminActions = actions; session = auth; closeDb = () => db.end();
  adminData = await import("../src/modules/admin/data");
});
after(async () => { await closeDb?.(); await schema?.drop(); });
beforeEach(async () => {
  cookieStore.clear();
  await schema.pool.query("DELETE FROM service_application_attempts");
});

test("a customer's upgrade request is stored while the account stays a customer at list prices", async () => {
  const id = await create("upgrade@example.invalid", "customer");
  await signIn(id);
  assert.equal(await upgrade({ email: "other@example.invalid", role: "service", approved: "true", discount_percent: "50", id: randomUUID() }), "/servisler/basvuru?sent=1");
  const stored = await request(id);
  assert.deepEqual({ ...stored, created_at: undefined }, { service_name: details.name, contact_name: details.contactName, phone: details.phone, city: details.city, created_at: undefined });
  const after = await account("upgrade@example.invalid");
  assert.deepEqual([after.role, after.approved, after.discount_percent, after.name, after.email], ["customer", true, 0, "Önceki Ad", "upgrade@example.invalid"]);
  assert.equal(await account("other@example.invalid"), undefined);
});

test("a second request keeps the first values and the fourth within the hour is refused", async () => {
  const id = await create("twice@example.invalid", "customer");
  await signIn(id);
  await upgrade();
  assert.equal(await upgrade({ name: "Başka Servis" }), "/servisler/basvuru?sent=1");
  assert.equal((await request(id)).service_name, details.name);
  assert.equal(await upgrade(), "/servisler/basvuru?sent=1");
  assert.equal(await upgrade(), "/servisler/basvuru?error=limit");
  const keys = (await schema.pool.query<{ key: string }>("SELECT key FROM service_application_attempts")).rows.map(row => row.key);
  assert.deepEqual(keys, [`upgrade:${id}`]);
});

test("invalid details are refused without a request", async () => {
  const id = await create("invalid@example.invalid", "customer");
  await signIn(id);
  assert.equal(await upgrade({ phone: "12" }), "/servisler/basvuru?error=validation");
  assert.equal(await upgrade({ terms: "" }), "/servisler/basvuru?error=validation");
  assert.equal(await request(id), undefined);
});

test("without a session the request goes to login; service and admin accounts cannot apply", async () => {
  assert.equal(await upgrade(), "/giris?next=%2Fservisler%2Fbasvuru");
  for (const role of ["service", "admin"] as const) {
    const id = await create(`${role}-apply@example.invalid`, role);
    await signIn(id);
    assert.equal(await upgrade(), "/servisler/basvuru", role);
    assert.equal(await request(id), undefined, role);
    assert.equal((await account(`${role}-apply@example.invalid`)).role, role);
  }
});

test("approval turns the same account into a service account with the requested details", async () => {
  const id = await create("approve@example.invalid", "customer");
  const token = await signIn(id);
  await upgrade();
  const before = await account("approve@example.invalid");
  assert.equal(await services.approveServiceAccount(id, 15), true);
  const approved = await account("approve@example.invalid");
  assert.deepEqual({ ...approved }, { ...before, role: "service", approved: true, discount_percent: 15, name: details.name, contact_name: details.contactName, phone: details.phone, city: details.city });
  assert.equal(await request(id), undefined);
  // The customer's session carries on as the service account.
  cookieStore.set("gb_session", token);
  const current = await session.currentAccount();
  assert.equal(current?.id, id);
  assert.equal(current?.role, "service");
  assert.equal(await services.approveServiceAccount(id, 20), false);
  assert.equal((await account("approve@example.invalid")).discount_percent, 15);
});

test("approval needs a request: a customer without one stays a customer", async () => {
  const id = await create("no-request@example.invalid", "customer");
  assert.equal(await services.approveServiceAccount(id, 10), false);
  const unchanged = await account("no-request@example.invalid");
  assert.deepEqual([unchanged.role, unchanged.discount_percent], ["customer", 0]);
});

test("a waiting service account is still approved as before", async () => {
  const id = await create("waiting@example.invalid", "service", false);
  assert.equal(await services.approveServiceAccount(id, 5), true);
  const approved = await account("waiting@example.invalid");
  assert.deepEqual([approved.role, approved.approved, approved.discount_percent], ["service", true, 5]);
});

test("an admin's rejection removes the request, keeps the customer and allows a new request", async () => {
  const id = await create("reject@example.invalid", "customer");
  const admin = await create("admin-reject@example.invalid", "admin");
  await signIn(id);
  await upgrade();
  const before = await account("reject@example.invalid");
  await signIn(admin);
  assert.equal(await redirected(adminActions.rejectServiceApplication(form({ id }))), "/yonetim?rejected=1");
  assert.equal(await request(id), undefined);
  assert.deepEqual(await account("reject@example.invalid"), before);
  assert.equal(await redirected(adminActions.rejectServiceApplication(form({ id }))), "/yonetim?error=validation");
  assert.equal(await redirected(adminActions.rejectServiceApplication(form({ id: "not-a-uuid" }))), "/yonetim?error=validation");
  await signIn(id);
  assert.equal(await upgrade({ name: "Yeni Servis" }), "/servisler/basvuru?sent=1");
  assert.equal((await request(id)).service_name, "Yeni Servis");
});

test("a customer cannot reject a request", async () => {
  const id = await create("self-reject@example.invalid", "customer");
  await signIn(id);
  await upgrade();
  await assert.rejects(adminActions.rejectServiceApplication(form({ id })), /NEXT_REDIRECT \//);
  assert.ok(await request(id));
});

const guest = (email: string) => redirected(application.applyForService(form({ ...details, email, password: "uzun-bir-sifre-123", website: "" })));

test("the guest form sends an existing customer to login and leaves the account untouched", async () => {
  await create("guest-customer@example.invalid", "customer");
  const before = await account("guest-customer@example.invalid");
  assert.equal(await guest("Guest-Customer@Example.invalid"), "/servisler/basvuru?error=account");
  assert.deepEqual(await account("guest-customer@example.invalid"), before);
  assert.equal(await request(before.id), undefined);
});

test("the guest form answers neutrally for a service address and creates a waiting service account for a new one", async () => {
  await create("pending-service@example.invalid", "service", false);
  assert.equal(await guest("pending-service@example.invalid"), "/servisler/basvuru?sent=1");
  assert.equal(await guest("new-service@example.invalid"), "/servisler/basvuru?sent=1");
  const created = await account("new-service@example.invalid");
  assert.deepEqual([created.role, created.approved, created.discount_percent, created.name], ["service", false, 0, details.name]);
});

test("the admin lists, counts and flags open requests next to waiting service accounts", async () => {
  await schema.pool.query("DELETE FROM service_upgrade_requests");
  await schema.pool.query("UPDATE accounts SET approved=true WHERE role='service'");
  const id = await create("listed@example.invalid", "customer");
  const waiting = await create("listed-service@example.invalid", "service", false);
  await signIn(id);
  await upgrade();
  await signIn(await create("admin-list@example.invalid", "admin"));
  const { accounts } = await adminData.adminOverview();
  assert.deepEqual(accounts.map(a => [a.id, a.name, a.upgrade, a.account_name]).sort(), [[id, details.name, true, "Önceki Ad"], [waiting, "Önceki Ad", false, null]].sort());
  assert.equal((await adminData.adminNavCounts()).services, 2);
  const customers = await adminData.adminCustomerAccounts();
  assert.equal(customers.upgrades, 1);
  assert.equal(customers.accounts.find(c => c.id === id)?.upgrade_pending, true);
  assert.equal(customers.accounts.filter(c => c.upgrade_pending).length, 1);
});

test("a deactivated customer's request is neither listed nor approvable", async () => {
  const id = await create("deactivated@example.invalid", "customer");
  await signIn(id);
  await upgrade();
  await schema.pool.query("UPDATE accounts SET approved=false WHERE id=$1", [id]);
  assert.equal(await services.approveServiceAccount(id, 10), false);
  const unchanged = await account("deactivated@example.invalid");
  assert.deepEqual([unchanged.role, unchanged.approved, unchanged.discount_percent], ["customer", false, 0]);
  await signIn(await create("admin-deactivated@example.invalid", "admin"));
  assert.equal((await adminData.adminOverview()).accounts.some(a => a.id === id), false);
  assert.equal((await adminData.adminCustomerAccounts()).accounts.find(c => c.id === id)?.upgrade_pending, false);
});

test("a submit racing a role change waits for it and stores no request for the service account", async () => {
  const id = await create("race@example.invalid", "customer");
  await signIn(id);
  const client = await schema.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE accounts SET role='service' WHERE id=$1", [id]);
    const submit = upgrade();
    await new Promise(resolve => setTimeout(resolve, 200));
    await client.query("COMMIT");
    assert.equal(await submit, "/servisler/basvuru?sent=1");
  } finally { client.release(); }
  assert.equal(await request(id), undefined);
});
