import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test, type TestContext } from "node:test";
import { compare } from "bcryptjs";
// The real next/server for the link route and connection(); the mock below keeps it and replaces only `after`.
import * as nextServer from "next/server";
import { NextRequest } from "next/server";
import type { MailMessage } from "../src/lib/mail";
import { siteUrl } from "../src/lib/site";
import { buildAccountExistsEmail, buildEmailVerificationEmail } from "../src/modules/auth/account-email";
import { initialResetState } from "../src/modules/auth/reset-state";
import { initialSignupState } from "../src/modules/auth/signup-state";
import { isolatedSchema } from "./isolated-schema";

// E-mail verification before a customer account opens (#1258): the e-mails, then signup, the link route, the verify
// and resend actions, login and password reset against an isolated schema. Cookies are an in-memory jar, request
// headers a mutable Headers object, and next/server's `after` collects its callbacks so a test can run them after the
// "response".
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
mock.module("next/server", { namedExports: { ...nextServer, after: (callback: () => Promise<unknown>) => { afterCallbacks.push(callback); } } });
// No mail provider: sendMail skips and, outside production, logs the verification link.
delete process.env.MAIL_TRANSPORT;

const password = "dogru-at-pil-zımba";
const resendMessage = "Bu adres doğrulama bekliyorsa yeni bir doğrulama bağlantısı gönderdik. Bağlantı 24 saat geçerlidir; gelen kutunu ve spam klasörünü kontrol et.";
const limitError = "Çok fazla deneme yapıldı. Bir saat sonra tekrar dene.";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("the verification e-mail greets without a name and carries the link in both parts", () => {
  const url = "https://getirbakim.example/e-posta-dogrula/baglanti?t=abc_DEF-123";
  const mail = buildEmailVerificationEmail({ url, hours: 24 });
  assert.equal(mail.subject, "E-posta adresini doğrula");
  assert.ok(mail.text.startsWith("Merhaba,\n"));
  assert.ok(mail.text.includes(url));
  assert.ok(mail.text.includes("Bağlantı 24 saat geçerlidir ve yalnızca bir kez kullanılabilir."));
  assert.ok(mail.text.includes("Bu hesabı sen oluşturmadıysan bağlantıyı açma; doğrulanmayan kayıt 7 gün içinde silinir."));
  assert.ok(mail.html.includes("Merhaba,"));
  assert.ok(mail.html.includes(`href="${url}"`));
  assert.ok(mail.html.includes("E-postamı doğrula"));
});

test("the account-exists e-mail escapes the name and links login and password reset", () => {
  const mail = buildAccountExistsEmail({ name: "<i>Ali</i>", loginUrl: "https://getirbakim.example/giris", resetUrl: "https://getirbakim.example/sifre-yenile" });
  assert.equal(mail.subject, "Zaten bir Getirbakim hesabın var");
  assert.ok(mail.text.includes("Bu e-posta adresiyle yeni bir kayıt denendi; hesabın zaten açık."));
  assert.ok(mail.text.includes("Bu denemeyi sen yapmadıysan bir şey yapmana gerek yok; hesabın değişmedi."));
  assert.ok(mail.text.includes("https://getirbakim.example/giris") && mail.text.includes("https://getirbakim.example/sifre-yenile"));
  assert.ok(mail.html.includes("Merhaba &lt;i&gt;Ali&lt;/i&gt;,"));
  assert.ok(mail.html.includes('href="https://getirbakim.example/giris"') && mail.html.includes('href="https://getirbakim.example/sifre-yenile"'));
});

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let signup: typeof import("../src/modules/auth/customer-signup");
let verification: typeof import("../src/modules/auth/email-verification");
let actions: typeof import("../src/modules/auth/email-verification-actions");
let auth: typeof import("../src/modules/auth/actions");
let reset: typeof import("../src/modules/auth/password-reset");
let tokens: typeof import("../src/modules/auth/account-tokens");
let linkRoute: typeof import("../src/app/(store)/e-posta-dogrula/baglanti/route");
let closeDb: () => Promise<void>;
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const signupForm = (email: string, overrides: Record<string, string> = {}) =>
  form({ name: "Ayşe Yılmaz", email, newPassword: password, confirmPassword: password, terms: "on", website: "", ...overrides });
const redirected = async (action: Promise<unknown>) => {
  try { await action; } catch (error) { const match = /^NEXT_REDIRECT (.*)$/.exec((error as Error).message); if (match) return match[1]; throw error; }
  assert.fail("expected a redirect");
};
type Row = { id: string; name: string; role: string; approved: boolean; password_hash: string; email_verified_at: Date | null };
const account = async (email: string) => (await schema.pool.query<Row>("SELECT id,name,role,approved,password_hash,email_verified_at FROM accounts WHERE email=$1", [email])).rows[0];
const createAccount = async (email: string, { role = "customer", approved = true, verified = true } = {}) => (await schema.pool.query<{ id: string }>(
  `INSERT INTO accounts (name,email,password_hash,role,approved,email_verified_at) VALUES ('Önceki',$1,'eski-hash',$2,$3,${verified ? "now()" : "NULL"}) RETURNING id`,
  [email, role, approved])).rows[0].id;
const tokenRows = async (accountId: string) => (await schema.pool.query<{ token_hash: string; purpose: string; return_to: string | null; origin_hash: string | null }>(
  "SELECT token_hash,purpose,return_to,origin_hash FROM account_tokens WHERE account_id=$1 ORDER BY purpose", [accountId])).rows;
const sessionsOf = async (id: string) => Number((await schema.pool.query<{ count: string }>("SELECT count(*) FROM sessions WHERE account_id=$1", [id])).rows[0].count);
const acceptancesOf = async (id: string) => Number((await schema.pool.query<{ count: string }>("SELECT count(*) FROM account_term_acceptances WHERE account_id=$1", [id])).rows[0].count);
const outbox = () => {
  const messages: MailMessage[] = [];
  return { messages, send: async (message: MailMessage) => { messages.push(message); return { status: "sent" as const, messageId: randomUUID() }; } };
};
const tokenOf = (message: MailMessage) => new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get("t")!;
/** Runs the collected `after` callbacks and returns what they logged with console.info. */
async function runAfter(t: TestContext) {
  const info = t.mock.method(console, "info", () => undefined);
  await Promise.all(afterCallbacks.splice(0).map(callback => callback()));
  const lines = info.mock.calls.map(call => String(call.arguments[0]));
  info.mock.restore();
  return lines;
}
/** The raw token from the dev-only link line the skipped send logs. */
const loggedToken = (lines: string[]) => {
  const line = lines.find(entry => entry.startsWith("E-mail verification link (dev only): "));
  return line ? new URL(line.split(": ")[1]).searchParams.get("t")! : null;
};
/** Signs up in this "browser" and returns the account and the mailed token. */
async function signUp(t: TestContext, email: string, overrides: Record<string, string> = {}) {
  const state = await signup.registerCustomer(initialSignupState, signupForm(email, overrides));
  assert.equal(state.status, "sent");
  const token = loggedToken(await runAfter(t));
  assert.ok(token);
  return { account: await account(email.toLowerCase()), token };
}

before(async () => {
  schema = await isolatedSchema("email_verification_test");
  const [{ db }, signupModule, service, action, login, resetModule, helpers, route] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/auth/customer-signup"), import("../src/modules/auth/email-verification"), import("../src/modules/auth/email-verification-actions"),
    import("../src/modules/auth/actions"), import("../src/modules/auth/password-reset"), import("../src/modules/auth/account-tokens"),
    import("../src/app/(store)/e-posta-dogrula/baglanti/route")]);
  signup = signupModule; verification = service; actions = action; auth = login; reset = resetModule; tokens = helpers; linkRoute = route; closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });
beforeEach(async () => {
  cookieStore.clear();
  requestHeaders = new Headers();
  afterCallbacks.length = 0;
  await schema.pool.query("DELETE FROM service_application_attempts");
  await schema.pool.query("DELETE FROM login_attempts");
});

test("a signup creates an unverified approved customer without a session and sets the origin cookie", async (t) => {
  const state = await signup.registerCustomer(initialSignupState, signupForm("New@Example.invalid", { next: "/sepet?adim=2" }));
  assert.deepEqual(state, { status: "sent", message: "", attempt: 1, values: { name: "Ayşe Yılmaz", email: "new@example.invalid", terms: false } });
  const created = await account("new@example.invalid");
  assert.equal(created.role, "customer");
  assert.equal(created.approved, true);
  assert.equal(created.email_verified_at, null);
  assert.equal(await sessionsOf(created.id), 0);
  assert.equal(cookieStore.has("gb_session"), false);
  const nonce = cookieStore.get("gb_verify_origin");
  assert.ok(nonce);
  // The mail goes after the response; until then there is no token.
  assert.deepEqual(await tokenRows(created.id), []);
  const lines = await runAfter(t);
  assert.ok(lines.includes(`E-mail verification mail skipped for account ${created.id}`), lines.join("\n"));
  const token = loggedToken(lines)!;
  assert.deepEqual(await tokenRows(created.id), [{ token_hash: sha(token), purpose: "email_verification", return_to: "/sepet?adim=2", origin_hash: sha(nonce) }]);
  const expiry = (await schema.pool.query<{ hours: number }>("SELECT round(extract(epoch FROM expires_at-now())/3600)::int AS hours FROM account_tokens WHERE account_id=$1", [created.id])).rows[0].hours;
  assert.equal(expiry, 24);
});

test("signup answers the same for a new address and one with an account, which gets an account-exists mail or nothing", async (t) => {
  const fresh = await signup.registerCustomer(initialSignupState, signupForm("fresh@example.invalid"));
  afterCallbacks.length = 0;
  const cases: [string, { role?: string; approved?: boolean }, string | null][] = [
    ["verified@example.invalid", {}, "Account exists"], ["service@example.invalid", { role: "service" }, "Account exists"],
    ["pending@example.invalid", { role: "service", approved: false }, null], ["admin@example.invalid", { role: "admin" }, null]];
  for (const [email, options, mail] of cases) {
    const id = await createAccount(email, options);
    const before = await account(email);
    cookieStore.clear();
    const state = await signup.registerCustomer(initialSignupState, signupForm(email.toUpperCase(), { name: "Yeni Ad" }));
    assert.deepEqual(state, { ...fresh, values: { name: "Yeni Ad", email, terms: false } }, email);
    assert.ok(cookieStore.has("gb_verify_origin"), email);
    const lines = await runAfter(t);
    assert.deepEqual(lines, mail ? [`${mail} mail skipped for account ${id}`] : [], email);
    assert.deepEqual(await account(email), before, email);
    assert.equal(await acceptancesOf(id), 0, email);
    assert.deepEqual(await tokenRows(id), [], email);
  }
});

test("sendEmailVerification mails the right e-mail and a failed send withdraws the token without logging the address", async (t) => {
  t.mock.method(console, "info", () => undefined);
  const unverified = await createAccount("waiting@example.invalid", { verified: false });
  await createAccount("open@example.invalid");
  const mail = outbox();
  assert.equal(await verification.sendEmailVerification("waiting@example.invalid", { send: mail.send, baseUrl: "https://getirbakim.example", returnTo: "/hesap" }), "sent");
  assert.equal(mail.messages[0].subject, "E-posta adresini doğrula");
  const token = tokenOf(mail.messages[0]);
  assert.ok(mail.messages[0].text.includes(`https://getirbakim.example/e-posta-dogrula/baglanti?t=${token}`));
  // Without notifyExisting (a resend) an open account gets nothing; with it, the account-exists mail.
  assert.equal(await verification.sendEmailVerification("open@example.invalid", { send: mail.send }), "none");
  assert.equal(await verification.sendEmailVerification("open@example.invalid", { send: mail.send, notifyExisting: true, baseUrl: "https://getirbakim.example" }), "sent");
  assert.equal(mail.messages[1].subject, "Zaten bir Getirbakim hesabın var");
  assert.equal(await verification.sendEmailVerification("nobody@example.invalid", { send: mail.send, notifyExisting: true }), "none");
  assert.equal(mail.messages.length, 2);
  const logged = t.mock.method(console, "error", () => undefined);
  const failure = Object.assign(new Error("554 Message rejected: waiting@example.invalid"), { code: "EMESSAGE" });
  assert.equal(await verification.sendEmailVerification("waiting@example.invalid", { send: async () => { throw failure; } }), "failed");
  assert.deepEqual(await tokenRows(unverified), []);
  assert.deepEqual(logged.mock.calls.map(call => call.arguments), [["E-mail verification mail failed", { account: unverified, code: "EMESSAGE" }]]);
});

test("a new signup for an unverified address replaces its password, name and acceptance and invalidates the old link", async (t) => {
  const first = await signUp(t, "again@example.invalid");
  const firstAcceptance = (await schema.pool.query<{ account_id: string }>("SELECT account_id FROM account_term_acceptances WHERE account_id=$1", [first.account.id])).rows;
  assert.equal(firstAcceptance.length, 1);
  const second = await signUp(t, "again@example.invalid", { name: "Yeni Ad", newPassword: "başka-bir-şifre-123", confirmPassword: "başka-bir-şifre-123" });
  assert.notEqual(second.account.id, first.account.id);
  assert.equal(second.account.name, "Yeni Ad");
  assert.equal(second.account.email_verified_at, null);
  assert.equal(await compare("başka-bir-şifre-123", second.account.password_hash), true);
  assert.equal(await acceptancesOf(first.account.id), 0);
  assert.equal(await acceptancesOf(second.account.id), 1);
  assert.equal(await verification.emailVerificationTarget(first.token), null);
  assert.ok(await verification.emailVerificationTarget(second.token));
});

const openLink = (query: string) => linkRoute.GET(new NextRequest(`https://evil.example/e-posta-dogrula/baglanti${query}`));
const assertSeeOther = (response: Response, location: string) => {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), location);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
};

test("the e-mail link moves a usable token into a /e-posta-dogrula cookie without using it up", async () => {
  const id = await createAccount("link@example.invalid", { verified: false });
  const token = await tokens.issueAccountToken(schema.pool, id, "email_verification", 24 * 60);
  const response = await openLink(`?t=${token}`);
  assertSeeOther(response, `${siteUrl}/e-posta-dogrula`);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.ok(cookie.startsWith(`gb_verify=${token};`), cookie);
  assert.match(cookie, /Path=\/e-posta-dogrula(;|$)/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=lax/i);
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
  assert.ok(maxAge > 86_000 && maxAge <= 86_400, String(maxAge));
  assert.deepEqual((await tokenRows(id)).map(row => row.token_hash), [sha(token)]);
  assert.equal((await account("link@example.invalid")).email_verified_at, null);
});

test("an unusable e-mail link lands on ?durum=gecersiz and clears the verify cookie", async () => {
  const id = await createAccount("badlink@example.invalid", { verified: false });
  const reset = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  for (const query of ["", "?t=", `?t=${reset}`, `?t=${"a".repeat(65)}`, "?t=uydurma-token"]) {
    const response = await openLink(query);
    assertSeeOther(response, `${siteUrl}/e-posta-dogrula?durum=gecersiz`);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^gb_verify=;/, query);
    assert.match(cookie, /Max-Age=0/);
  }
});

test("verifying in the signup browser verifies, moves the guest cart, logs in and returns to the stored path", async (t) => {
  const guest = randomBytes(32).toString("hex"), guestHash = sha(guest), product = randomUUID();
  await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [guestHash]);
  await schema.pool.query("INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity) VALUES('guest',$1,$2,2)", [guestHash, product]);
  cookieStore.set("gb_cart", guest);
  const { account: created, token } = await signUp(t, "verify@example.invalid", { next: "/sepet" });
  cookieStore.set("gb_verify", token);
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/sepet");
  const verified = await account("verify@example.invalid");
  assert.ok(verified.email_verified_at instanceof Date);
  assert.equal(await compare(password, verified.password_hash), true);
  assert.equal(await sessionsOf(created.id), 1);
  assert.ok(cookieStore.get("gb_session"));
  assert.equal(cookieStore.has("gb_verify"), false);
  assert.equal(cookieStore.has("gb_verify_origin"), false);
  const items = await schema.pool.query<{ owner_kind: string; owner_id: string }>("SELECT owner_kind,owner_id FROM commerce_cart_items WHERE product_id=$1", [product]);
  assert.deepEqual(items.rows, [{ owner_kind: "account", owner_id: created.id }]);
  // Single use.
  cookieStore.set("gb_verify", token);
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/e-posta-dogrula?durum=gecersiz");
});

test("an unsafe stored path sends the verified customer home", async (t) => {
  const { account: created } = await signUp(t, "unsafe@example.invalid");
  // A path stored by an older or tampered row is checked again on the way out.
  const token = await tokens.issueAccountToken(schema.pool, created.id, "email_verification", 60, { returnTo: "//evil.invalid", originHash: sha(cookieStore.get("gb_verify_origin")!) });
  cookieStore.set("gb_verify", token);
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/");
  assert.equal(await sessionsOf(created.id), 1);
});

test("verifying in another browser verifies, discards the signup password and asks for a new one", async (t) => {
  const { account: created, token } = await signUp(t, "other@example.invalid", { next: "/hesap" });
  // A session the signup password could have opened elsewhere ends too.
  await schema.pool.query("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 day')", [sha("eski"), created.id]);
  cookieStore.clear();
  cookieStore.set("gb_verify", token);
  cookieStore.set("gb_verify_origin", "baska-tarayicinin-nonce-degeri");
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/sifre-yenile?dogrulama=tamam");
  const verified = await account("other@example.invalid");
  assert.ok(verified.email_verified_at instanceof Date);
  assert.match(verified.password_hash, /^\$2[aby]\$12\$/);
  assert.equal(await compare(password, verified.password_hash), false);
  assert.equal(await sessionsOf(created.id), 0);
  assert.equal(cookieStore.has("gb_session"), false);
  assert.equal(cookieStore.has("gb_verify"), false);
  const resetToken = cookieStore.get("gb_reset");
  assert.ok(resetToken);
  assert.deepEqual((await tokenRows(created.id)).map(row => [row.purpose, row.token_hash]), [["password_reset", sha(resetToken)]]);
  assert.ok(await reset.passwordResetTarget(resetToken));
  assert.equal(await redirected(auth.login(form({ email: "other@example.invalid", password }))), "/giris?error=1");
  // The reset token sets the new password and opens the account.
  assert.equal(await reset.completePasswordReset(resetToken, "yeni-ve-uzun-şifre-42"), true);
  assert.equal(await redirected(auth.login(form({ email: "other@example.invalid", password: "yeni-ve-uzun-şifre-42" }))), "/");
  // A browser without any nonce counts as another browser.
  const second = await signUp(t, "other2@example.invalid");
  cookieStore.clear();
  cookieStore.set("gb_verify", second.token);
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/sifre-yenile?dogrulama=tamam");
  assert.ok(cookieStore.has("gb_reset"));
});

test("the verification target tells whether this is the signup browser", async (t) => {
  const { token } = await signUp(t, "target@example.invalid");
  const nonce = cookieStore.get("gb_verify_origin")!;
  assert.equal((await verification.emailVerificationTarget(token, sha(nonce)))?.sameBrowser, true);
  assert.equal((await verification.emailVerificationTarget(token, sha("başka")))?.sameBrowser, false);
  assert.equal((await verification.emailVerificationTarget(token))?.sameBrowser, false);
});

test("an expired, wrong-purpose, malformed or missing token verifies nothing", async () => {
  const id = await createAccount("refused@example.invalid", { verified: false });
  const expired = await tokens.issueAccountToken(schema.pool, id, "email_verification", 60);
  await schema.pool.query("UPDATE account_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [sha(expired)]);
  const resetToken = await tokens.issueAccountToken(schema.pool, id, "password_reset", 60);
  for (const token of [expired, resetToken, "", "a".repeat(65), "x'; DROP TABLE accounts;--"]) assert.equal(await verification.completeEmailVerification(token, null), null, token);
  cookieStore.set("gb_verify", resetToken);
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/e-posta-dogrula?durum=gecersiz");
  assert.equal(await redirected(actions.verifyEmail(initialResetState)), "/e-posta-dogrula?durum=gecersiz");
  assert.equal((await account("refused@example.invalid")).email_verified_at, null);
  // A token of an account that is no longer an unverified customer is refused and kept.
  const live = await tokens.issueAccountToken(schema.pool, id, "email_verification", 60);
  await schema.pool.query("UPDATE accounts SET approved=false WHERE id=$1", [id]);
  assert.equal(await verification.completeEmailVerification(live, null), null);
  assert.equal((await tokenRows(id)).filter(row => row.purpose === "email_verification").length, 1);
});

test("login tells only the right password that the address waits for verification", async (t) => {
  const { account: created, token } = await signUp(t, "login@example.invalid");
  const origin = sha(cookieStore.get("gb_verify_origin")!);
  cookieStore.clear();
  const attempt = (pw: string) => redirected(auth.login(form({ email: "Login@Example.invalid", password: pw, next: "/hesap" })));
  assert.equal(await attempt("yanlış-şifre-12345"), "/giris?error=1&next=%2Fhesap");
  assert.equal(await attempt(password), "/giris?error=dogrulama&next=%2Fhesap");
  assert.equal(await sessionsOf(created.id), 0);
  assert.equal((await verification.completeEmailVerification(token, origin))?.signedIn, true);
  assert.equal(await attempt(password), "/hesap");
  assert.equal(await sessionsOf(created.id), 1);
});

test("a resend answers the same for every address, replaces the link and refuses the fourth for one address", async (t) => {
  const { account: created, token: first } = await signUp(t, "resend@example.invalid");
  await createAccount("open-resend@example.invalid");
  cookieStore.clear();
  const waiting = await actions.resendVerification(initialResetState, form({ email: "Resend@Example.invalid", next: "/sepet" }));
  assert.deepEqual(waiting, { status: "sent", message: resendMessage, attempt: 1 });
  assert.ok(cookieStore.has("gb_verify_origin"));
  const nonce = cookieStore.get("gb_verify_origin")!;
  const second = loggedToken(await runAfter(t))!;
  assert.notEqual(second, first);
  assert.equal(await verification.emailVerificationTarget(first), null);
  assert.deepEqual((await tokenRows(created.id)).map(row => [row.return_to, row.origin_hash]), [["/sepet", sha(nonce)]]);
  for (const email of ["open-resend@example.invalid", "nobody@example.invalid"]) {
    assert.deepEqual(await actions.resendVerification(initialResetState, form({ email })), waiting, email);
    assert.deepEqual(await runAfter(t), [], email);
  }
  for (let attempt = 2; attempt <= 3; attempt++) assert.equal((await actions.resendVerification(initialResetState, form({ email: "resend@example.invalid" }))).status, "sent");
  assert.deepEqual(await actions.resendVerification(initialResetState, form({ email: "resend@example.invalid" })),
    { status: "error", message: limitError, attempt: 1, email: "resend@example.invalid" });
  assert.deepEqual(await actions.resendVerification(initialResetState, form({ email: "not-an-email" })),
    { status: "error", message: "Geçerli bir e-posta adresi gir.", attempt: 1, email: "not-an-email" });
});

test("a password reset verifies an unverified signup and deletes its verification link", async (t) => {
  const { account: created, token } = await signUp(t, "reset@example.invalid");
  t.mock.method(console, "info", () => undefined);
  const mail = outbox();
  assert.equal(await reset.sendPasswordReset("reset@example.invalid", { send: mail.send }), "sent");
  assert.equal(await reset.completePasswordReset(tokenOf(mail.messages[0]), "yeni-ve-uzun-şifre-42"), true);
  assert.ok((await account("reset@example.invalid")).email_verified_at instanceof Date);
  assert.deepEqual(await tokenRows(created.id), []);
  assert.equal(await verification.emailVerificationTarget(token), null);
});
