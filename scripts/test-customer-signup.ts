import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import * as nextServer from "next/server";
import { legalDocument, type LegalNode } from "../src/content/legal";
import { accountEmailEnabled } from "../src/modules/auth/account-email-switch";
import { membershipConsentText } from "../src/modules/auth/membership-consent";
import { legalPageVersion, membershipTermsSlug, privacyNoticeSlug } from "../src/modules/auth/membership-terms";
import { customerSignupSchema } from "../src/modules/auth/schemas";
import { initialSignupState } from "../src/modules/auth/signup-state";
import { isolatedSchema } from "./isolated-schema";

// Individual customer signup (#1254): the schema, and the Server Action against an isolated schema. Cookies are an
// in-memory jar and request headers a mutable Headers object, standing in for the Server Action request; next/server's
// `after` collects the verification mail's callback (#1258, covered by test-email-verification.ts).
const cookieStore = new Map<string, string>();
const jar = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
  set: (name: string, value: string) => { cookieStore.set(name, value); },
  delete: (name: string) => { cookieStore.delete(name); },
};
let requestHeaders = new Headers();
mock.module("next/headers", { namedExports: { cookies: async () => jar, headers: async () => requestHeaders } });
mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });
const afterCallbacks: (() => Promise<unknown>)[] = [];
mock.module("next/server", { namedExports: { ...nextServer, after: (callback: () => Promise<unknown>) => { afterCallbacks.push(callback); } } });
delete process.env.MAIL_TRANSPORT;
// Signup is on unless a test turns account e-mail off (#1303), whatever .env.local says.
process.env.ACCOUNT_EMAIL = "on";

const valid = { name: "  Ayşe Yılmaz ", email: "Ayse@Example.invalid", password: "dogru-at-pil-zımba", confirmPassword: "dogru-at-pil-zımba", terms: "on", website: "" };
const fieldError = "Bilgileri kontrol et: şifre en az 12 karakter olmalı, iki şifre aynı olmalı ve koşulları kabul etmelisin.";
// What a refusal of signupForm(email) answers on the first attempt: the message, the typed name, email and consent, never a password.
const refused = (message: string, email: string, values: Partial<{ name: string; terms: boolean }> = {}) =>
  ({ status: "error", message, attempt: 1, values: { name: "Ayşe Yılmaz", email, terms: true, ...values } });
// What a signup answers on the first attempt, whatever the address (#1258).
const sent = (email: string, name = "Ayşe Yılmaz") => ({ status: "sent", message: "", attempt: 1, values: { name, email, terms: false } });
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
    // A name from an unverified form must not carry a link, an address or a line break (#1258).
    ["name with a link", { ...valid, name: "Kazan https://spam.invalid" }],
    ["name with www.", { ...valid, name: "Bak WWW.spam.invalid" }],
    ["name with an address", { ...valid, name: "yaz bana@spam.invalid" }],
    ["name with a line break", { ...valid, name: "Ayşe\nYılmaz" }],
    ["name with a control character", { ...valid, name: "Ayşe\u0007 Yılmaz" }],
    ["name with a line separator", { ...valid, name: "Ayşe\u2028Yılmaz" }],
  ];
  for (const [name, input] of refused) assert.equal(customerSignupSchema.safeParse(input).success, false, name);
  const mismatch = customerSignupSchema.safeParse({ ...valid, confirmPassword: "başka-bir-şifre-123" });
  assert.deepEqual(mismatch.error?.issues.map(issue => issue.path), [["confirmPassword"]]);
});

test("a legal page version is its date and a hash of its copy, and changes when the copy is edited", () => {
  const page = legalDocument(membershipTermsSlug)!;
  const version = legalPageVersion(membershipTermsSlug);
  assert.match(version, /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{12}$/);
  assert.ok(version.startsWith(`${page.updatedAt}.`));
  const edited = { ...page, sections: [{ title: page.sections[0].title, blocks: [...page.sections[0].blocks, "Ek cümle."] }, ...page.sections.slice(1)] };
  assert.notEqual(legalPageVersion(membershipTermsSlug, edited), version);
  assert.throws(() => legalPageVersion("olmayan-sayfa"), /Legal page missing/);
});

test("the KVKK notice and the privacy policy describe individual membership in the same words", () => {
  const notice = legalDocument(privacyNoticeSlug)!, policy = legalDocument("gizlilik-politikasi")!;
  const shared = notice.sections.filter(section => policy.sections.some(other => other.title === section.title));
  assert.ok(shared.length >= 5);
  for (const section of shared) assert.deepEqual(policy.sections.find(other => other.title === section.title), section, section.title);
  const text = (node: LegalNode): string => typeof node === "string" ? node : node.children.map(text).join("");
  for (const page of [notice, policy]) {
    assert.ok(page.sections.some(section => section.title === "Bireysel Üyelik"), page.title);
    const copy = page.sections.flatMap(section => section.blocks.map(text)).join("\n");
    assert.equal(copy.includes("yetkili yönetici tarafından servis hesabı oluşturulurken sisteme girilir"), false, page.title);
  }
  assert.ok(legalDocument(membershipTermsSlug)!.updatedAt >= "2026-11-22");
});

test("account e-mail opens in production only when switched on with a mail transport, elsewhere unless switched off (#1303)", () => {
  const ses = { MAIL_TRANSPORT: "ses", MAIL_FROM: "Getirbakim <siparis@example.invalid>" };
  const cases: [string, Record<string, string | undefined>, boolean][] = [
    ["production, unset", { NODE_ENV: "production", ...ses }, false],
    ["production, on without mail", { NODE_ENV: "production", ACCOUNT_EMAIL: "on" }, false],
    ["production, on with file transport", { NODE_ENV: "production", ACCOUNT_EMAIL: "on", MAIL_TRANSPORT: "file", MAIL_FROM: ses.MAIL_FROM }, false],
    ["production, other value with ses", { NODE_ENV: "production", ACCOUNT_EMAIL: "true", ...ses }, false],
    ["production, on with ses", { NODE_ENV: "production", ACCOUNT_EMAIL: "on", ...ses }, true],
    ["production, padded upper-case on with ses", { NODE_ENV: "production", ACCOUNT_EMAIL: " ON ", ...ses }, true],
    ["development, unset", { NODE_ENV: "development" }, true],
    ["test, unset", { NODE_ENV: "test" }, true],
    ["no NODE_ENV, unset", {}, true],
    ["development, off", { NODE_ENV: "development", ACCOUNT_EMAIL: "off" }, false],
    ["development, padded upper-case off", { NODE_ENV: "development", ACCOUNT_EMAIL: " OFF " }, false],
    ["development, on", { NODE_ENV: "development", ACCOUNT_EMAIL: "on" }, true],
  ];
  for (const [name, env, expected] of cases) assert.equal(accountEmailEnabled(env), expected, name);
});

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let signup: typeof import("../src/modules/auth/customer-signup");
let closeDb: () => Promise<void>;
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const signupForm = (email: string, overrides: Record<string, string> = {}) =>
  form({ name: "Ayşe Yılmaz", email, newPassword: valid.password, confirmPassword: valid.password, terms: "on", website: "", ...overrides });
const account = async (email: string) => (await schema.pool.query<{ id: string; name: string; role: string; approved: boolean; discount_percent: number; password_hash: string; applied_at: Date | null; email_verified_at: Date | null }>(
  "SELECT id,name,role,approved,discount_percent,password_hash,applied_at,email_verified_at FROM accounts WHERE email=$1", [email])).rows[0];
type Acceptance = { document: string; terms_version: string; privacy_notice_version: string; consent_text: string; ip: string | null; forwarded_for: string | null; user_agent: string | null; accepted_at: Date };
const acceptancesOf = async (id: string) => (await schema.pool.query<Acceptance>(
  "SELECT document,terms_version,privacy_notice_version,consent_text,ip,forwarded_for,user_agent,accepted_at FROM account_term_acceptances WHERE account_id=$1", [id])).rows;
const acceptanceCount = async () => Number((await schema.pool.query<{ count: string }>("SELECT count(*) FROM account_term_acceptances")).rows[0].count);
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
  afterCallbacks.length = 0;
  await schema.pool.query("DELETE FROM service_application_attempts");
});

test("a signup creates an unverified approved customer without discount and does not log it in", async () => {
  const state = await signup.registerCustomer(initialSignupState, signupForm("New@Example.invalid", { next: "/sepet?adim=2", role: "admin", approved: "false", discount_percent: "50" }));
  assert.deepEqual(state, sent("new@example.invalid"));
  const created = await account("new@example.invalid");
  assert.equal(created.name, "Ayşe Yılmaz");
  assert.equal(created.role, "customer");
  assert.equal(created.approved, true);
  assert.equal(created.discount_percent, 0);
  assert.ok(created.applied_at);
  assert.equal(created.email_verified_at, null);
  assert.match(created.password_hash, /^\$2[aby]\$12\$/);
  assert.equal(await sessionsOf(created.id), 0);
  assert.equal(cookieStore.has("gb_session"), false);
  assert.ok(cookieStore.has("gb_verify_origin"));
  assert.equal(afterCallbacks.length, 1);
});

test("a signup records one immutable acceptance of the membership terms with the request's evidence (#1256)", async () => {
  requestHeaders = new Headers({ "cloudfront-viewer-address": "198.51.100.10:443", "x-forwarded-for": "203.0.113.5", "user-agent": "Test Browser/1.0" });
  await signup.registerCustomer(initialSignupState, signupForm("terms@example.invalid"));
  const created = await account("terms@example.invalid");
  const rows = await acceptancesOf(created.id);
  assert.equal(rows.length, 1);
  const [{ accepted_at, ...row }] = rows;
  assert.deepEqual(row, {
    document: "uyelik-ve-kullanim-kosullari", terms_version: legalPageVersion(membershipTermsSlug), privacy_notice_version: legalPageVersion(privacyNoticeSlug),
    consent_text: membershipConsentText, ip: "198.51.100.10", forwarded_for: "203.0.113.5", user_agent: "Test Browser/1.0",
  });
  assert.ok(accepted_at instanceof Date && Math.abs(accepted_at.getTime() - Date.now()) < 60_000);
  await assert.rejects(schema.pool.query("UPDATE account_term_acceptances SET consent_text='değişti' WHERE account_id=$1", [created.id]), /immutable/);
  await schema.pool.query("DELETE FROM accounts WHERE id=$1", [created.id]);
  assert.equal((await acceptancesOf(created.id)).length, 0);
});

test("an address that already has an account gets the same answer and is neither logged in nor overwritten", async () => {
  const existing: [string, string, boolean][] = [["service@example.invalid", "service", true], ["pending@example.invalid", "service", false], ["customer@example.invalid", "customer", true], ["admin@example.invalid", "admin", true]];
  for (const [email, role, approved] of existing) {
    await schema.pool.query("INSERT INTO accounts(name,email,password_hash,role,approved,discount_percent) VALUES('Önceki',$1,'eski-hash',$2,$3,$4)", [email, role, approved, role === "service" ? 15 : 0]);
    const previous = await account(email);
    assert.ok(previous.email_verified_at, email);
    const state = await signup.registerCustomer(initialSignupState, signupForm(email.toUpperCase(), { name: "Yeni Ad" }));
    assert.deepEqual(state, sent(email, "Yeni Ad"), email);
    assert.deepEqual(await account(email), previous, email);
    assert.equal(await sessionsOf(previous.id), 0, email);
    assert.equal(cookieStore.has("gb_session"), false, email);
    assert.equal((await acceptancesOf(previous.id)).length, 0, email);
  }
});

test("invalid input, including a filled honeypot, returns the field error and creates nothing", async () => {
  const acceptedBefore = await acceptanceCount();
  const cases: Record<string, string>[] = [{ website: "https://spam.invalid" }, { confirmPassword: "farklı-bir-şifre-1" }, { terms: "" }, { newPassword: "kisa", confirmPassword: "kisa" }];
  for (const overrides of cases) {
    const state = await signup.registerCustomer(initialSignupState, signupForm("invalid@example.invalid", overrides));
    assert.deepEqual(state, refused(fieldError, "invalid@example.invalid", { terms: overrides.terms !== "" }), JSON.stringify(overrides));
  }
  assert.equal(await account("invalid@example.invalid"), undefined);
  assert.equal((await schema.pool.query("SELECT 1 FROM service_application_attempts")).rowCount, 0);
  assert.equal(await acceptanceCount(), acceptedBefore);
});

test("the fourth attempt for one address within the hour is refused", async () => {
  for (let attempt = 1; attempt <= 3; attempt++)
    assert.deepEqual(await signup.registerCustomer(initialSignupState, signupForm("limit@example.invalid")), sent("limit@example.invalid"));
  assert.deepEqual(await signup.registerCustomer(initialSignupState, signupForm("Limit@Example.invalid")), refused(limitError, "Limit@Example.invalid"));
  const keys = (await schema.pool.query<{ key: string }>("SELECT key FROM service_application_attempts ORDER BY key")).rows.map(row => row.key);
  assert.deepEqual(keys, ["signup:email:" + createHash("sha256").update("limit@example.invalid").digest("hex"), "signup:global"]);
});

test("one client address gets ten signups an hour", async () => {
  requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.7" });
  for (let attempt = 1; attempt <= 10; attempt++)
    assert.equal((await signup.registerCustomer(initialSignupState, signupForm(`ip-${attempt}@example.invalid`))).status, "sent");
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

test("with account e-mail off a signup is refused before any budget, row, cookie or mail (#1303)", async () => {
  const acceptedBefore = await acceptanceCount();
  process.env.ACCOUNT_EMAIL = "off";
  try {
    const state = await signup.registerCustomer(initialSignupState, signupForm("closed@example.invalid"));
    assert.deepEqual(state, { status: "error", message: "Yeni üyelik kaydı şu anda kapalı.", attempt: 1 });
  } finally {
    process.env.ACCOUNT_EMAIL = "on";
  }
  assert.equal(await account("closed@example.invalid"), undefined);
  assert.equal(await acceptanceCount(), acceptedBefore);
  assert.equal((await schema.pool.query("SELECT 1 FROM service_application_attempts")).rowCount, 0);
  assert.equal(cookieStore.size, 0);
  assert.equal(afterCallbacks.length, 0);
});
