import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { compare } from "bcryptjs";
// The real request/response classes for the link route; the mock below keeps them and replaces only `after`.
import { NextRequest, NextResponse } from "next/server";
import type { MailMessage } from "../src/lib/mail";
import { siteUrl } from "../src/lib/site";
import { buildPasswordResetEmail } from "../src/modules/auth/account-email";
import { initialResetState } from "../src/modules/auth/reset-state";
import { resetPasswordSchema, resetRequestSchema } from "../src/modules/auth/schemas";
import { isolatedSchema } from "./isolated-schema";

// Password reset by e-mail (#1257): schemas and the e-mail, then the token helpers and Server Actions against an
// isolated schema. Cookies are an in-memory jar, request headers a mutable Headers object, and next/server's `after`
// collects its callbacks so a test can run them after the "response".
const cookieStore = new Map<string, string>();
const jar = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
  set: (name: string, value: string, options?: { maxAge?: number }) => { if (options?.maxAge === 0) cookieStore.delete(name); else cookieStore.set(name, value); },
  delete: (name: string) => { cookieStore.delete(name); },
};
let requestHeaders = new Headers();
const afterCallbacks: (() => Promise<unknown>)[] = [];
mock.module("next/headers", { namedExports: { cookies: async () => jar, headers: async () => requestHeaders } });
mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });
mock.module("next/server", { namedExports: { NextRequest, NextResponse, after: (callback: () => Promise<unknown>) => { afterCallbacks.push(callback); } } });
// No mail provider: sendMail skips, so the action's background send only issues the token.
delete process.env.MAIL_TRANSPORT;
// Password reset is on unless a test turns account e-mail off (#1303), whatever .env.local says.
process.env.ACCOUNT_EMAIL = "on";

const password = "yeni-ve-uzun-şifre-42";
const sentMessage = "Bu adrese kayıtlı bir hesap varsa şifre yenileme bağlantısını gönderdik. Bağlantı 60 dakika geçerlidir; gelen kutunu ve spam klasörünü kontrol et.";
const limitError = "Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("the reset schemas lowercase the email and refuse a bad address, a short, mismatched or oversized password", () => {
  assert.deepEqual(resetRequestSchema.parse({ email: "Ayse@Example.invalid" }), { email: "ayse@example.invalid" });
  for (const email of ["", "not-an-email", `${"a".repeat(200)}@example.invalid`]) assert.equal(resetRequestSchema.safeParse({ email }).success, false, email);
  assert.equal(resetPasswordSchema.safeParse({ password, confirmPassword: password }).success, true);
  const refused: [string, Record<string, unknown>][] = [
    ["short", { password: "kisa-sifre1", confirmPassword: "kisa-sifre1" }],
    ["over 72 bytes", { password: "ş".repeat(40), confirmPassword: "ş".repeat(40) }],
    ["missing", { password: null, confirmPassword: null }],
  ];
  for (const [name, input] of refused) assert.equal(resetPasswordSchema.safeParse(input).success, false, name);
  assert.deepEqual(resetPasswordSchema.safeParse({ password, confirmPassword: `${password}x` }).error?.issues.map(issue => issue.path), [["confirmPassword"]]);
});

test("the reset e-mail escapes the name and carries the link in both parts", () => {
  const url = "https://getirbakim.example/sifre-yenile/baglanti?t=abc_DEF-123";
  const mail = buildPasswordResetEmail({ name: "<b>Ayşe</b> & Co", url, minutes: 60 });
  assert.equal(mail.subject, "Şifre yenileme bağlantın");
  assert.ok(mail.text.includes("Merhaba <b>Ayşe</b> & Co,"));
  assert.ok(mail.text.includes(url));
  assert.ok(mail.text.includes("Bağlantı 60 dakika geçerlidir ve yalnızca bir kez kullanılabilir."));
  assert.ok(mail.html.includes("Merhaba &lt;b&gt;Ayşe&lt;/b&gt; &amp; Co,"));
  assert.ok(!mail.html.includes("<b>Ayşe"));
  assert.ok(mail.html.includes(`href="${url}"`));
  assert.ok(mail.html.includes("Şifremi yenile"));
});

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let reset: typeof import("../src/modules/auth/password-reset");
let actions: typeof import("../src/modules/auth/password-reset-actions");
let tokens: typeof import("../src/modules/auth/account-tokens");
let linkRoute: typeof import("../src/app/(store)/sifre-yenile/baglanti/route");
let closeDb: () => Promise<void>;
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const redirected = async (action: Promise<unknown>) => {
  try { await action; } catch (error) { const match = /^NEXT_REDIRECT (.*)$/.exec((error as Error).message); if (match) return match[1]; throw error; }
  assert.fail("expected a redirect");
};
const createAccount = async (email: string, role = "customer", approved = true) => (await schema.pool.query<{ id: string }>(
  "INSERT INTO accounts (name,email,password_hash,role,approved) VALUES ('Ayşe Yılmaz',$1,'eski-hash',$2,$3) RETURNING id", [email, role, approved])).rows[0].id;
const tokenRows = async (accountId: string) => (await schema.pool.query<{ token_hash: string; purpose: string; minutes: number }>(
  "SELECT token_hash,purpose,round(extract(epoch FROM expires_at-now())/60)::int AS minutes FROM account_tokens WHERE account_id=$1", [accountId])).rows;
const spent = async (key: string) => (await schema.pool.query<{ attempts: number }>("SELECT attempts FROM service_application_attempts WHERE key=$1", [key])).rows[0]?.attempts;
// Sends into an array instead of a mail provider.
const outbox = () => {
  const messages: MailMessage[] = [];
  return { messages, send: async (message: MailMessage) => { messages.push(message); return { status: "sent" as const, messageId: randomUUID() }; } };
};
const tokenOf = (message: MailMessage) => new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get("t")!;

before(async () => {
  schema = await isolatedSchema("password_reset_test");
  const [{ db }, service, action, helpers, route] = await Promise.all([import("../src/lib/db"), import("../src/modules/auth/password-reset"),
    import("../src/modules/auth/password-reset-actions"), import("../src/modules/auth/account-tokens"), import("../src/app/(store)/sifre-yenile/baglanti/route")]);
  reset = service; actions = action; tokens = helpers; linkRoute = route; closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });
beforeEach(async () => {
  cookieStore.clear();
  requestHeaders = new Headers();
  afterCallbacks.length = 0;
  await schema.pool.query("DELETE FROM service_application_attempts");
});

test("an approved customer or service account gets one hashed token of about an hour and the mail", async () => {
  for (const [email, role] of [["customer@example.invalid", "customer"], ["service@example.invalid", "service"]]) {
    const id = await createAccount(email, role);
    const mail = outbox();
    assert.equal(await reset.sendPasswordReset(email, { send: mail.send, baseUrl: "https://getirbakim.example" }), "sent");
    assert.equal(mail.messages.length, 1);
    assert.equal(mail.messages[0].to, email);
    const token = tokenOf(mail.messages[0]);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(mail.messages[0].text.includes(`https://getirbakim.example/sifre-yenile/baglanti?t=${token}`));
    const rows = await tokenRows(id);
    assert.deepEqual(rows.map(row => ({ ...row, minutes: row.minutes >= 59 && row.minutes <= 60 })), [{ token_hash: sha(token), purpose: "password_reset", minutes: true }]);
  }
});

test("an unknown address, a pending service and an admin get no token and no mail", async () => {
  const pending = await createAccount("pending@example.invalid", "service", false);
  const admin = await createAccount("admin@example.invalid", "admin");
  const mail = outbox();
  for (const email of ["nobody@example.invalid", "pending@example.invalid", "admin@example.invalid"]) assert.equal(await reset.sendPasswordReset(email, { send: mail.send }), "none");
  assert.equal(mail.messages.length, 0);
  assert.deepEqual([...await tokenRows(pending), ...await tokenRows(admin)], []);
});

test("a second request replaces the first link, and a failed send withdraws only its token and logs no address", async (t) => {
  const id = await createAccount("twice@example.invalid");
  const mail = outbox();
  await reset.sendPasswordReset("twice@example.invalid", { send: mail.send });
  await reset.sendPasswordReset("twice@example.invalid", { send: mail.send });
  const [first, second] = mail.messages.map(tokenOf);
  assert.equal(await reset.passwordResetTarget(first), null);
  assert.ok(await reset.passwordResetTarget(second));
  assert.deepEqual((await tokenRows(id)).map(row => row.token_hash), [sha(second)]);
  const verification = await tokens.issueAccountToken(schema.pool, id, "email_verification", 60);
  const logged = t.mock.method(console, "error", () => undefined);
  const failure = Object.assign(new Error("554 Message rejected: twice@example.invalid"), { code: "EMESSAGE" });
  assert.equal(await reset.sendPasswordReset("twice@example.invalid", { send: async () => { throw failure; } }), "failed");
  assert.deepEqual((await tokenRows(id)).map(row => row.token_hash), [sha(verification)]);
  assert.deepEqual(logged.mock.calls.map(call => call.arguments), [["Password reset mail failed", { account: id, code: "EMESSAGE" }]]);
});

test("a reset request answers the same for a known and an unknown address and mails after the response", async () => {
  const id = await createAccount("known@example.invalid");
  const known = await actions.requestPasswordReset(initialResetState, form({ email: "Known@Example.invalid" }));
  const unknown = await actions.requestPasswordReset(initialResetState, form({ email: "unknown@example.invalid" }));
  assert.deepEqual(known, { status: "sent", message: sentMessage, attempt: 1 });
  assert.deepEqual(unknown, known);
  assert.equal(afterCallbacks.length, 2);
  assert.deepEqual(await tokenRows(id), []);
  await Promise.all(afterCallbacks.map(callback => callback()));
  assert.equal((await tokenRows(id)).length, 1);
  assert.deepEqual(await actions.requestPasswordReset(initialResetState, form({ email: "not-an-email" })), { status: "error", message: "Geçerli bir e-posta adresi gir.", attempt: 1, email: "not-an-email" });
});

test("the sixth request for one address is refused without spending the shared budget", async () => {
  for (let attempt = 1; attempt <= 5; attempt++) assert.equal((await actions.requestPasswordReset(initialResetState, form({ email: "busy@example.invalid" }))).status, "sent");
  assert.deepEqual(await actions.requestPasswordReset(initialResetState, form({ email: "busy@example.invalid" })), { status: "error", message: limitError, attempt: 1, email: "busy@example.invalid" });
  assert.equal(afterCallbacks.length, 5);
  assert.equal(await spent("reset:global"), 5);
});

test("one client address gets ten requests an hour, whatever the addresses", async () => {
  requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.9" });
  for (let attempt = 1; attempt <= 10; attempt++) assert.equal((await actions.requestPasswordReset(initialResetState, form({ email: `ip-${attempt}@example.invalid` }))).status, "sent");
  assert.equal((await actions.requestPasswordReset(initialResetState, form({ email: "ip-11@example.invalid" }))).message, limitError);
  assert.equal(await spent("reset:email:" + sha("ip-11@example.invalid")), undefined);
  assert.equal(await spent("reset:global"), 10);
});

test("a reset sets the new password, ends every session and forgets the token and failed logins", async () => {
  const id = await createAccount("done@example.invalid");
  const mail = outbox();
  await reset.sendPasswordReset("done@example.invalid", { send: mail.send });
  const token = tokenOf(mail.messages[0]);
  await schema.pool.query("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 day'),($3,$2,now()+interval '1 day')", [sha("a"), id, sha("b")]);
  await schema.pool.query("INSERT INTO login_attempts (email,attempts) VALUES ('done@example.invalid',5)");
  const previous = (await schema.pool.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE id=$1", [id])).rows[0].password_hash;
  assert.equal(await reset.completePasswordReset(token, password), true);
  const updated = (await schema.pool.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE id=$1", [id])).rows[0].password_hash;
  assert.match(updated, /^\$2[aby]\$12\$/);
  assert.notEqual(updated, previous);
  assert.equal(await compare(password, updated), true);
  assert.equal(await compare("eski-şifre-12345", updated), false);
  assert.equal((await schema.pool.query("SELECT 1 FROM sessions WHERE account_id=$1", [id])).rowCount, 0);
  assert.deepEqual(await tokenRows(id), []);
  assert.equal((await schema.pool.query("SELECT 1 FROM login_attempts WHERE email='done@example.invalid'")).rowCount, 0);
  // Single use.
  assert.equal(await reset.completePasswordReset(token, "başka-bir-şifre-123"), false);
});

test("an expired, wrong-purpose or malformed token sets nothing, nor does an account unapproved after the mail", async () => {
  const id = await createAccount("refused@example.invalid");
  const hashOf = async () => (await schema.pool.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE id=$1", [id])).rows[0].password_hash;
  const original = await hashOf();
  const expired = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  await schema.pool.query("UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [sha(expired)]);
  assert.equal(await reset.completePasswordReset(expired, password), false);
  const verification = await tokens.issueAccountToken(schema.pool, id, "email_verification", 60);
  assert.equal(await reset.completePasswordReset(verification, password), false);
  for (const garbage of ["", "a".repeat(65), "bad token!", "x'; DROP TABLE accounts;--"]) assert.equal(await reset.completePasswordReset(garbage, password), false, garbage);
  const live = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  await schema.pool.query("UPDATE accounts SET approved=false WHERE id=$1", [id]);
  assert.equal(await reset.completePasswordReset(live, password), false);
  assert.equal(await hashOf(), original);
  assert.equal((await tokenRows(id)).filter(row => row.purpose === "email_verification").length, 1);
});

test("the new-password action redirects to /giris and clears the reset and session cookies", async () => {
  const id = await createAccount("action@example.invalid");
  const token = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  cookieStore.set("gb_reset", token);
  cookieStore.set("gb_session", "eski-oturum");
  cookieStore.set("gb_session_at", "1");
  assert.deepEqual(await actions.resetPassword(initialResetState, form({ newPassword: password, confirmPassword: `${password}x` })),
    { status: "error", message: "Şifreler aynı olmalı.", attempt: 1 });
  assert.equal((await actions.resetPassword(initialResetState, form({ newPassword: "kisa-sifre1", confirmPassword: "kisa-sifre1" }))).message, "Şifre en az 12 karakter olmalı.");
  assert.equal((await actions.resetPassword(initialResetState, form({ newPassword: "ş".repeat(40), confirmPassword: "ş".repeat(40) }))).message, "Şifre en fazla 72 UTF-8 bayt olabilir.");
  assert.equal(cookieStore.get("gb_reset"), token);
  assert.equal(await redirected(actions.resetPassword(initialResetState, form({ newPassword: password, confirmPassword: password }))), "/giris?sifre=yenilendi");
  assert.deepEqual([...cookieStore.keys()], []);
  const hash = (await schema.pool.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE id=$1", [id])).rows[0].password_hash;
  assert.equal(await compare(password, hash), true);
});

test("the new-password action with a used or missing link sends back to /sifre-yenile?durum=gecersiz", async () => {
  cookieStore.set("gb_reset", "kullanilmis-ya-da-uydurma-bir-token");
  assert.equal(await redirected(actions.resetPassword(initialResetState, form({ newPassword: password, confirmPassword: password }))), "/sifre-yenile?durum=gecersiz");
  assert.equal(cookieStore.has("gb_reset"), false);
  assert.equal(await redirected(actions.resetPassword(initialResetState, form({ newPassword: password, confirmPassword: password }))), "/sifre-yenile?durum=gecersiz");
});

const openLink = (query: string) => linkRoute.GET(new NextRequest(`https://evil.example/sifre-yenile/baglanti${query}`));
const assertSeeOther = (response: Response, location: string) => {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), location);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
};

test("the e-mail link moves a usable token into a /sifre-yenile cookie without using it up", async () => {
  const id = await createAccount("link@example.invalid");
  const token = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  const response = await openLink(`?t=${token}`);
  assertSeeOther(response, `${siteUrl}/sifre-yenile`);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.ok(cookie.startsWith(`gb_reset=${token};`), cookie);
  assert.match(cookie, /Path=\/sifre-yenile(;|$)/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=lax/i);
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
  assert.ok(maxAge > 3500 && maxAge <= 3600, String(maxAge));
  assert.deepEqual((await tokenRows(id)).map(row => row.token_hash), [sha(token)]);
});

test("an unusable e-mail link lands on ?durum=gecersiz and clears the reset cookie", async () => {
  const id = await createAccount("badlink@example.invalid");
  const expired = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  await schema.pool.query("UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [sha(expired)]);
  for (const query of ["", "?t=", `?t=${expired}`, `?t=${"a".repeat(65)}`, "?t=uydurma-token"]) {
    const response = await openLink(query);
    assertSeeOther(response, `${siteUrl}/sifre-yenile?durum=gecersiz`);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^gb_reset=;/, query);
    assert.match(cookie, /Path=\/sifre-yenile(;|$)/);
    assert.match(cookie, /Max-Age=0/);
  }
});

test("with account e-mail off reset is refused and its link and form leave the token and password alone (#1303)", async () => {
  const closed = "Bu işlem şu anda kullanılamıyor. Destek için bizimle iletişime geç.";
  const id = await createAccount("closed@example.invalid");
  const token = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  const hashOf = async () => (await schema.pool.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE id=$1", [id])).rows[0].password_hash;
  process.env.ACCOUNT_EMAIL = "off";
  try {
    assert.deepEqual(await actions.requestPasswordReset(initialResetState, form({ email: "closed@example.invalid" })), { status: "error", message: closed, attempt: 1 });
    assert.equal(afterCallbacks.length, 0);
    assert.equal((await schema.pool.query("SELECT 1 FROM service_application_attempts")).rowCount, 0);
    cookieStore.set("gb_reset", token);
    assert.equal(await redirected(actions.resetPassword(initialResetState, form({ newPassword: password, confirmPassword: password }))), "/giris");
    assert.equal(cookieStore.get("gb_reset"), token);
    const response = await openLink(`?t=${token}`);
    assertSeeOther(response, `${siteUrl}/giris`);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    process.env.ACCOUNT_EMAIL = "on";
  }
  assert.deepEqual((await tokenRows(id)).map(row => row.token_hash), [sha(token)]);
  assert.equal(await hashOf(), "eski-hash");
});
