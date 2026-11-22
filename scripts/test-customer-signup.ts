import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { customerSignupSchema } from "../src/modules/auth/schemas";
import { initialSignupState } from "../src/modules/auth/signup-state";
import { isolatedSchema } from "./isolated-schema";

// Individual customer signup (#1254): the schema, and the Server Action against an isolated schema. Cookies are an
// in-memory jar and request headers a mutable Headers object, standing in for the Server Action request.
const cookieStore = new Map<string, string>();
const jar = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
  set: (name: string, value: string) => { cookieStore.set(name, value); },
  delete: (name: string) => { cookieStore.delete(name); },
};
let requestHeaders = new Headers();
mock.module("next/headers", { namedExports: { cookies: async () => jar, headers: async () => requestHeaders } });
mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });

const valid = { name: "  Ayşe Yılmaz ", email: "Ayse@Example.invalid", password: "dogru-at-pil-zımba", confirmPassword: "dogru-at-pil-zımba", terms: "on", website: "" };
const fieldError = "Bilgileri kontrol et: şifre en az 12 karakter olmalı, iki şifre aynı olmalı ve koşulları kabul etmelisin.";
// What a refusal of signupForm(email) answers on the first attempt: the message, the typed name, email and consent, never a password.
const refused = (message: string, email: string, values: Partial<{ name: string; terms: boolean }> = {}) =>
  ({ status: "error", message, attempt: 1, values: { name: "Ayşe Yılmaz", email, terms: true, ...values } });
const duplicateError = "Bu e-posta adresiyle kayıt oluşturulamadı. Zaten hesabın varsa giriş yap.";
const limitError = "Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.";

test("the signup schema trims the name, lowercases the email and drops privilege fields", () => {
  const parsed = customerSignupSchema.parse({ ...valid, role: "admin", approved: "true", discount: "50", discount_percent: "50" });
  assert.deepEqual(parsed, { name: "Ayşe Yılmaz", email: "ayse@example.invalid", password: valid.password, confirmPassword: valid.password, terms: "on", website: "" });
});

test("the signup schema refuses a short, mismatched or oversized password, missing terms and a filled honeypot", () => {
  const refused: [string, Record<string, unknown>][] = [
    ["short password", { ...valid, password: "kisa-sifre1", confirmPassword: "kisa-sifre1" }],
    ["mismatched confirmation", { ...valid, confirmPassword: `${valid.password}x` }],
    ["missing terms", { ...valid, terms: undefined }],
    ["terms with another value", { ...valid, terms: "yes" }],
    ["filled honeypot", { ...valid, website: "https://spam.invalid" }],
    // 40 characters but 80 UTF-8 bytes: bcrypt reads only 72.
    ["password over 72 bytes", { ...valid, password: "ş".repeat(40), confirmPassword: "ş".repeat(40) }],
    ["short name", { ...valid, name: " A " }],
    ["bad email", { ...valid, email: "not-an-email" }],
  ];
  for (const [name, input] of refused) assert.equal(customerSignupSchema.safeParse(input).success, false, name);
  const mismatch = customerSignupSchema.safeParse({ ...valid, confirmPassword: "başka-bir-şifre-123" });
  assert.deepEqual(mismatch.error?.issues.map(issue => issue.path), [["confirmPassword"]]);
});

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let signup: typeof import("../src/modules/auth/customer-signup");
let closeDb: () => Promise<void>;
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const signupForm = (email: string, overrides: Record<string, string> = {}) =>
  form({ name: "Ayşe Yılmaz", email, newPassword: valid.password, confirmPassword: valid.password, terms: "on", website: "", ...overrides });
const redirected = async (action: Promise<unknown>) => {
  try { await action; } catch (error) { const match = /^NEXT_REDIRECT (.*)$/.exec((error as Error).message); if (match) return match[1]; throw error; }
  assert.fail("expected a redirect");
};
const account = async (email: string) => (await schema.pool.query<{ id: string; name: string; role: string; approved: boolean; discount_percent: number; password_hash: string; applied_at: Date | null }>(
  "SELECT id,name,role,approved,discount_percent,password_hash,applied_at FROM accounts WHERE email=$1", [email])).rows[0];
const sessionsOf = async (id: string) => Number((await schema.pool.query<{ count: string }>("SELECT count(*) FROM sessions WHERE account_id=$1", [id])).rows[0].count);

before(async () => {
  schema = await isolatedSchema("customer_signup_test");
  const [{ db }, action] = await Promise.all([import("../src/lib/db"), import("../src/modules/auth/customer-signup")]);
  signup = action; closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });
beforeEach(async () => {
  cookieStore.clear();
  requestHeaders = new Headers();
  await schema.pool.query("DELETE FROM service_application_attempts");
});

test("a signup creates an approved customer without discount, logs it in and returns to next", async () => {
  const to = await redirected(signup.registerCustomer(initialSignupState, signupForm("New@Example.invalid", { next: "/sepet?adim=2", role: "admin", approved: "false", discount_percent: "50" })));
  assert.equal(to, "/sepet?adim=2");
  const created = await account("new@example.invalid");
  assert.equal(created.name, "Ayşe Yılmaz");
  assert.equal(created.role, "customer");
  assert.equal(created.approved, true);
  assert.equal(created.discount_percent, 0);
  assert.ok(created.applied_at);
  assert.match(created.password_hash, /^\$2[aby]\$12\$/);
  assert.equal(await sessionsOf(created.id), 1);
  const token = cookieStore.get("gb_session");
  assert.ok(token);
  const session = await schema.pool.query("SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2", [createHash("sha256").update(token).digest("hex"), created.id]);
  assert.equal(session.rowCount, 1);
});

test("an unsafe or missing next sends the new customer home", async () => {
  assert.equal(await redirected(signup.registerCustomer(initialSignupState, signupForm("home@example.invalid", { next: "//evil.invalid" }))), "/");
  assert.equal(await redirected(signup.registerCustomer(initialSignupState, signupForm("home2@example.invalid"))), "/");
});

test("the guest cart moves to the new account and an earlier session is replaced", async () => {
  const guest = randomBytes(32).toString("hex"), guestHash = createHash("sha256").update(guest).digest("hex"), product = randomUUID();
  await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [guestHash]);
  await schema.pool.query("INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity) VALUES('guest',$1,$2,2)", [guestHash, product]);
  const other = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Eski','old-session@example.invalid','x','customer',true) RETURNING id")).rows[0].id;
  const oldToken = randomUUID();
  await schema.pool.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [createHash("sha256").update(oldToken).digest("hex"), other]);
  cookieStore.set("gb_cart", guest);
  cookieStore.set("gb_session", oldToken);
  await redirected(signup.registerCustomer(initialSignupState, signupForm("cart@example.invalid", { next: "/sepet" })));
  const created = await account("cart@example.invalid");
  const items = await schema.pool.query<{ owner_kind: string; owner_id: string; quantity: number }>("SELECT owner_kind,owner_id,quantity FROM commerce_cart_items WHERE product_id=$1", [product]);
  assert.deepEqual(items.rows, [{ owner_kind: "account", owner_id: created.id, quantity: 2 }]);
  assert.equal(await sessionsOf(other), 0);
  assert.notEqual(cookieStore.get("gb_session"), oldToken);
});

test("an address that already has an account is refused without login or overwrite, whatever its role", async () => {
  const existing: [string, string, boolean][] = [["service@example.invalid", "service", true], ["pending@example.invalid", "service", false], ["customer@example.invalid", "customer", true], ["admin@example.invalid", "admin", true]];
  for (const [email, role, approved] of existing) {
    await schema.pool.query("INSERT INTO accounts(name,email,password_hash,role,approved,discount_percent) VALUES('Önceki',$1,'eski-hash',$2,$3,$4)", [email, role, approved, role === "service" ? 15 : 0]);
    const previous = await account(email);
    const state = await signup.registerCustomer(initialSignupState, signupForm(email.toUpperCase(), { name: "Yeni Ad" }));
    assert.deepEqual(state, refused(duplicateError, email.toUpperCase(), { name: "Yeni Ad" }), email);
    assert.deepEqual(await account(email), previous, email);
    assert.equal(await sessionsOf(previous.id), 0, email);
    assert.equal(cookieStore.has("gb_session"), false, email);
  }
});

test("invalid input, including a filled honeypot, returns the field error and creates nothing", async () => {
  const cases: Record<string, string>[] = [{ website: "https://spam.invalid" }, { confirmPassword: "farklı-bir-şifre-1" }, { terms: "" }, { newPassword: "kisa", confirmPassword: "kisa" }];
  for (const overrides of cases) {
    const state = await signup.registerCustomer(initialSignupState, signupForm("invalid@example.invalid", overrides));
    assert.deepEqual(state, refused(fieldError, "invalid@example.invalid", { terms: overrides.terms !== "" }), JSON.stringify(overrides));
  }
  assert.equal(await account("invalid@example.invalid"), undefined);
  assert.equal((await schema.pool.query("SELECT 1 FROM service_application_attempts")).rowCount, 0);
});

test("the fourth attempt for one address within the hour is refused", async () => {
  await redirected(signup.registerCustomer(initialSignupState, signupForm("limit@example.invalid")));
  cookieStore.clear();
  for (let attempt = 2; attempt <= 3; attempt++)
    assert.deepEqual(await signup.registerCustomer(initialSignupState, signupForm("limit@example.invalid")), refused(duplicateError, "limit@example.invalid"));
  assert.deepEqual(await signup.registerCustomer(initialSignupState, signupForm("Limit@Example.invalid")), refused(limitError, "Limit@Example.invalid"));
  const keys = (await schema.pool.query<{ key: string }>("SELECT key FROM service_application_attempts ORDER BY key")).rows.map(row => row.key);
  assert.deepEqual(keys, ["signup:email:" + createHash("sha256").update("limit@example.invalid").digest("hex"), "signup:global"]);
});

test("one client address gets ten signups an hour", async () => {
  requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.7" });
  for (let attempt = 1; attempt <= 10; attempt++) {
    cookieStore.clear();
    await redirected(signup.registerCustomer(initialSignupState, signupForm(`ip-${attempt}@example.invalid`)));
  }
  for (let attempt = 11; attempt <= 15; attempt++)
    assert.deepEqual(await signup.registerCustomer(initialSignupState, signupForm(`ip-${attempt}@example.invalid`)), refused(limitError, `ip-${attempt}@example.invalid`));
  assert.equal(await account("ip-11@example.invalid"), undefined);
  // Refused by its client address, a request spends neither the shared budget nor its email's.
  const spent = async (key: string) => (await schema.pool.query<{ attempts: number }>("SELECT attempts FROM service_application_attempts WHERE key=$1", [key])).rows[0]?.attempts;
  assert.equal(await spent("signup:global"), 10);
  assert.equal(await spent("signup:email:" + createHash("sha256").update("ip-11@example.invalid").digest("hex")), undefined);
});

test("a refusal echoes the attempt count, so the form remounts with the typed values", async () => {
  const first = await signup.registerCustomer(initialSignupState, signupForm("echo@example.invalid", { confirmPassword: "farklı-bir-şifre-1" }));
  const second = await signup.registerCustomer(first, signupForm("echo@example.invalid", { confirmPassword: "farklı-bir-şifre-1" }));
  assert.equal(second.attempt, 2);
  assert.equal(JSON.stringify(second).includes(valid.password), false);
});
