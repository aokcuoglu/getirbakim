import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import type { MailMessage, MailResult } from "../src/lib/mail";
import type { ConfirmationData, StatusOrder } from "../src/modules/store/order-email";
import { canResendOrderEmail, orderEmailDue, orderEmailErrorLabel, orderEmailKinds, orderEmailNotDueLabel } from "../src/modules/store/order-email-state";
import { ORDER_LINK_COOKIE, ORDER_LINK_DAYS, orderLinkGrant, orderLinkOutcome, orderLinkPath, orderLinkSecret, orderLinkSecretEnv, orderLinkStatus, orderLinkToken, signOrderLink, verifyOrderLink } from "../src/modules/store/order-link";

// Order confirmation email (#951): content, mail settings, the .eml file transport and the outbox in a throwaway
// schema (db/schema.sql + db/commerce.sql applied twice). No mail leaves the machine: sends are injected or written to a temp dir.
const originalUrl = process.env.DATABASE_URL;
const originalSite = process.env.SITE_URL;
const originalLinkSecret = process.env[orderLinkSecretEnv];
let root: Pool, control: PoolClient, namespace = "";
let mail: typeof import("../src/lib/mail");
let email: typeof import("../src/modules/store/order-email");
let db: typeof import("../src/lib/db").db;
let adminOrders: typeof import("../src/modules/admin/orders");
let orderCancel: typeof import("../src/modules/store/order-cancel");

before(async () => {
  if (!originalUrl) throw new Error("DATABASE_URL required");
  root = new Pool({ connectionString: originalUrl });
  control = await root.connect();
  namespace = `order_email_test_${randomBytes(6).toString("hex")}`;
  await control.query(`CREATE SCHEMA ${namespace}`);
  const url = new URL(originalUrl); url.searchParams.set("options", `-c search_path=${namespace}`);
  process.env.DATABASE_URL = url.toString();
  process.env.SITE_URL = "https://shop.example.invalid";
  delete process.env[orderLinkSecretEnv];
  mail = await import("../src/lib/mail");
  email = await import("../src/modules/store/order-email");
  db = (await import("../src/lib/db")).db;
  adminOrders = await import("../src/modules/admin/orders");
  orderCancel = await import("../src/modules/store/order-cancel");
  await db.query(await readFile("db/schema.sql", "utf8"));
  const commerce = await readFile("db/commerce.sql", "utf8");
  await db.query(commerce); await db.query(commerce);
});
after(async () => {
  await db?.end();
  await control?.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
  control?.release(); await root?.end();
  process.env.DATABASE_URL = originalUrl;
  if (originalSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = originalSite;
  if (originalLinkSecret === undefined) delete process.env[orderLinkSecretEnv]; else process.env[orderLinkSecretEnv] = originalLinkSecret;
});

const baseOrder: ConfirmationData["order"] = {
  id: "11111111-2222-4333-8444-555555555555", number: "1042", customer_name: "Ayşe Yılmaz", phone: "0555 123 45 67",
  address: "Moda Cad. No 1, 34710 Kadıköy/İstanbul", note: "", created_at: new Date("2026-11-19T09:30:00Z"),
  subtotal_kurus: "250000", shipping_kurus: "0", total_kurus: "250000", discount_percent: 0, installment_count: 1, installment_fee_kurus: "0",
  invoice_type: "individual", invoice_company: null, invoice_tax_no: null, invoice_tax_office: null,
  invoice_province: null, invoice_district: null, invoice_address_line: null, invoice_postal_code: null,
};
const items = [
  { name: "Fren Diski", code: "BOSCH 0986", quantity: 2, unit_price_kurus: "75000" },
  { name: "Fren Balatası", code: "TRW GDB1", quantity: 1, unit_price_kurus: "100000" },
];
const build = (order: Partial<ConfirmationData["order"]> = {}, extra: Partial<ConfirmationData> = {}) =>
  email.buildOrderConfirmation({ order: { ...baseOrder, ...order }, items, hasAgreement: true, baseUrl: "https://shop.example.invalid/", ...extra });

test("the confirmation lists the lines, totals, addresses and links", () => {
  const { subject, text, html } = build();
  assert.equal(subject, "Siparişini aldık — #1042");
  for (const part of ["Merhaba Ayşe Yılmaz,", "Ödemen alındı; siparişin teyit bekliyor", "Sipariş no: #1042",
    "- Fren Diski", "BOSCH 0986 · 2 adet × ₺750,00 = ₺1.500,00", "TRW GDB1 · 1 adet × ₺1.000,00 = ₺1.000,00",
    "Ürün toplamı: ₺2.500,00", "Kargo: Ücretsiz", "Toplam (KDV dahil): ₺2.500,00",
    "Teslimat adresi\nAyşe Yılmaz\n0555 123 45 67\nModa Cad. No 1, 34710 Kadıköy/İstanbul",
    // The invoice goes to the delivery address when no separate one was given.
    "Fatura adresi\nModa Cad. No 1, 34710 Kadıköy/İstanbul",
    "Siparişini görüntüle: https://shop.example.invalid/siparis/11111111-2222-4333-8444-555555555555",
    "Sözleşme kopyan: https://shop.example.invalid/siparis/11111111-2222-4333-8444-555555555555/sozlesme",
    "Mesafeli satış sözleşmesi: https://shop.example.invalid/mesafeli-satis-sozlesmesi",
    "Ön bilgilendirme formu: https://shop.example.invalid/on-bilgilendirme-formu", "hey@getirbakim.com", "+90 216 387 00 78"]) {
    assert.ok(text.includes(part), `text is missing: ${part}`);
  }
  // Never "confirmed": the order still waits for operations.
  assert.doesNotMatch(text, /onaylandı/i); assert.doesNotMatch(html, /onaylandı/i);
  assert.doesNotMatch(text, /Servis indirimi|Vade farkı|Not:|Fatura: Kurumsal/);
  assert.doesNotMatch(text, /<[a-z/][^>]*>/i, "text has no tags");
  assert.match(html, /<html lang="tr">/);
  assert.match(html, /href="https:\/\/shop\.example\.invalid\/siparis\/11111111-2222-4333-8444-555555555555\/sozlesme"/);
  assert.doesNotMatch(html, /<img/i, "no remote images");
});

const linkSecret = "s".repeat(32);
const linkOrder = baseOrder.id;
const linkNow = new Date("2026-11-21T10:00:00Z");

test("signed order links verify only for their order, secret and lifetime", () => {
  const token = signOrderLink(linkOrder, new Date(linkNow.getTime() + 3_600_000), linkSecret);
  assert.match(token, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyOrderLink(linkOrder, token, linkSecret, linkNow), true);
  assert.equal(verifyOrderLink("11111111-2222-4333-8444-555555555556", token, linkSecret, linkNow), false, "another order");
  assert.equal(verifyOrderLink(linkOrder, token, "t".repeat(32), linkNow), false, "another secret");
  const [exp, sig] = token.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(verifyOrderLink(linkOrder, `${exp}.${flipped}`, linkSecret, linkNow), false, "tampered signature");
  assert.equal(verifyOrderLink(linkOrder, `${Number(exp) + 86_400}.${sig}`, linkSecret, linkNow), false, "extended expiry");
  assert.equal(verifyOrderLink(linkOrder, token, linkSecret, new Date(Number(exp) * 1000)), false, "expired at exp");
  assert.equal(verifyOrderLink(linkOrder, token, linkSecret, new Date(linkNow.getTime() + 7_200_000)), false, "expired");
  for (const bad of ["", sig, `${exp}${sig}`, `x${exp}.${sig}`, `-1.${sig}`, `${exp}.${sig}.x`, `${exp}.${sig}=`, `${exp}.${sig}`.padStart(81, "0"), `${exp}.${sig.slice(1)}`]) {
    assert.equal(verifyOrderLink(linkOrder, bad, linkSecret, linkNow), false, `malformed: ${bad}`);
  }
  assert.equal(verifyOrderLink(linkOrder, undefined, linkSecret, linkNow), false);
});

test("order links need a secret of 32+ characters and last 90 days", () => {
  assert.equal(orderLinkSecret({}), null);
  assert.equal(orderLinkSecret({ [orderLinkSecretEnv]: "x".repeat(31) }), null);
  assert.equal(orderLinkSecret({ [orderLinkSecretEnv]: `  ${"x".repeat(31)}  ` }), null, "trimmed before the length check");
  assert.equal(orderLinkSecret({ [orderLinkSecretEnv]: ` ${linkSecret} ` }), linkSecret);
  assert.equal(orderLinkToken(linkOrder, linkNow, {}), null);
  const link = orderLinkToken(linkOrder, linkNow, { [orderLinkSecretEnv]: linkSecret });
  assert.ok(link);
  assert.equal(ORDER_LINK_DAYS, 90);
  assert.equal(link.expiresAt.getTime(), linkNow.getTime() + 90 * 86_400_000);
  assert.equal(verifyOrderLink(linkOrder, link.token, linkSecret, new Date(linkNow.getTime() + 89 * 86_400_000)), true);
  assert.equal(verifyOrderLink(linkOrder, link.token, linkSecret, new Date(linkNow.getTime() + 90 * 86_400_000)), false);
  assert.equal(orderLinkPath(linkOrder, link.token), `/siparis/${linkOrder}/erisim?t=${link.token}`);
  assert.equal(orderLinkPath(linkOrder, link.token, "sozlesme"), `/siparis/${linkOrder}/erisim?t=${link.token}&sayfa=sozlesme`);
});

test("the erisim grant: clean target from the site URL, a path-scoped cookie only for a valid link", () => {
  const exp = new Date(linkNow.getTime() + 3_600_000);
  const token = signOrderLink(linkOrder, exp, linkSecret);
  const base = { orderId: linkOrder, token, page: undefined, siteUrl: "https://shop.example.invalid", secret: linkSecret, now: linkNow, production: true } as const;
  const grant = orderLinkGrant(base);
  assert.equal(grant.target, `https://shop.example.invalid/siparis/${linkOrder}`);
  assert.deepEqual(grant.cookie, { name: ORDER_LINK_COOKIE, value: token,
    options: { httpOnly: true, secure: true, sameSite: "lax", path: `/siparis/${linkOrder}`, maxAge: 3600 } });
  assert.equal(orderLinkGrant({ ...base, production: false }).cookie?.options.secure, false);
  assert.equal(orderLinkGrant({ ...base, page: "sozlesme" }).target, `https://shop.example.invalid/siparis/${linkOrder}/sozlesme`);
  for (const denied of [{ token: undefined }, { token: `${token}x` }, { secret: null }, { secret: "t".repeat(32) }, { orderId: "11111111-2222-4333-8444-555555555556" }, { now: exp }]) {
    const result = orderLinkGrant({ ...base, ...denied });
    assert.equal(result.cookie, null, `no cookie for ${JSON.stringify(denied)}`);
    assert.match(result.target, /^https:\/\/shop\.example\.invalid\/siparis\/[0-9a-f-]{36}$/);
  }
});

test("order link status tells an expired link from an invalid one only after the signature checks out", () => {
  const exp = new Date(linkNow.getTime() + 3_600_000);
  const token = signOrderLink(linkOrder, exp, linkSecret);
  const [expText, sig] = token.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(orderLinkStatus(linkOrder, token, linkSecret, linkNow), "valid");
  assert.equal(orderLinkStatus(linkOrder, token, linkSecret, exp), "expired", "at exp");
  assert.equal(orderLinkStatus(linkOrder, token, linkSecret, new Date(exp.getTime() + 86_400_000)), "expired");
  assert.equal(orderLinkStatus(linkOrder, `${expText}.${flipped}`, linkSecret, new Date(exp.getTime() + 1000)), "invalid", "tampered signature, past exp");
  assert.equal(orderLinkStatus(linkOrder, `${Number(expText) + 86_400}.${sig}`, linkSecret, linkNow), "invalid", "extended expiry");
  assert.equal(orderLinkStatus("11111111-2222-4333-8444-555555555556", token, linkSecret, linkNow), "invalid");
  assert.equal(orderLinkStatus(linkOrder, token, "t".repeat(32), linkNow), "invalid");
  for (const bad of ["", undefined, sig, `${expText}.${sig.slice(1)}`, `${expText}.${sig}.x`]) assert.equal(orderLinkStatus(linkOrder, bad, linkSecret, linkNow), "invalid");
});

test("the erisim grant names the notice for an expired or invalid link without leaking the order or token", () => {
  const exp = new Date(linkNow.getTime() + 3_600_000);
  const token = signOrderLink(linkOrder, exp, linkSecret);
  const base = { orderId: linkOrder, token, page: undefined, siteUrl: "https://shop.example.invalid", secret: linkSecret, now: linkNow, production: true } as const;
  const notice = /^https:\/\/shop\.example\.invalid\/siparis\/baglanti\?durum=(suresi-doldu|gecersiz)$/;
  const cases: Array<[Partial<Parameters<typeof orderLinkGrant>[0]>, string, string]> = [
    [{}, "valid", "gecersiz"],
    [{ now: exp }, "expired", "suresi-doldu"],
    [{ token: undefined }, "invalid", "gecersiz"],
    [{ secret: null }, "invalid", "gecersiz"],
    [{ token: `${token}x` }, "invalid", "gecersiz"],
    [{ orderId: "11111111-2222-4333-8444-555555555556" }, "invalid", "gecersiz"],
  ];
  for (const [override, status, durum] of cases) {
    const grant = orderLinkGrant({ ...base, ...override });
    assert.equal(grant.status, status, JSON.stringify(override));
    assert.match(grant.notice, notice);
    assert.ok(grant.notice.endsWith(`durum=${durum}`), grant.notice);
    assert.ok(!grant.notice.includes(linkOrder) && !grant.notice.includes(token));
  }
});

test("the erisim outcome: cookie only for a granted guest order, viewable browsers pass, the rest get the notice", () => {
  const exp = new Date(linkNow.getTime() + 3_600_000);
  const token = signOrderLink(linkOrder, exp, linkSecret);
  const siteUrl = "https://shop.example.invalid";
  const base = { orderId: linkOrder, token, page: undefined, siteUrl, secret: linkSecret, now: linkNow, production: true } as const;
  const target = `${siteUrl}/siparis/${linkOrder}`;
  const notice = (durum: string) => `${siteUrl}/siparis/baglanti?durum=${durum}`;
  const valid = orderLinkGrant(base);
  const expired = orderLinkGrant({ ...base, now: exp });
  const invalid = orderLinkGrant({ ...base, token: undefined });
  assert.deepEqual(orderLinkOutcome(valid, { guestOrder: true, viewable: false, siteUrl }), { location: target, cookie: valid.cookie });
  assert.deepEqual(orderLinkOutcome(valid, { guestOrder: false, viewable: false, siteUrl }), { location: notice("gecersiz"), cookie: null });
  assert.deepEqual(orderLinkOutcome(valid, { guestOrder: false, viewable: true, siteUrl }), { location: target, cookie: null });
  assert.deepEqual(orderLinkOutcome(invalid, { guestOrder: false, viewable: true, siteUrl }), { location: target, cookie: null });
  assert.deepEqual(orderLinkOutcome(expired, { guestOrder: true, viewable: false, siteUrl }), { location: notice("suresi-doldu"), cookie: null });
  assert.deepEqual(orderLinkOutcome(invalid, { guestOrder: true, viewable: false, siteUrl }), { location: notice("gecersiz"), cookie: null });
});

test("the erisim route checks the guest order before the cookie, never sets one otherwise, and the notice page reads no order", async () => {
  const route = await readFile("src/app/(store)/siparis/[id]/erisim/route.ts", "utf8");
  assert.ok(route.indexOf("guestOrderExists(") > -1 && route.indexOf("guestOrderExists(") < route.indexOf("cookies.set("), "guest check before cookies.set");
  assert.match(route, /viewableOrder\(/);
  assert.match(route, /"Cache-Control", "no-store"/);
  assert.match(route, /"Referrer-Policy", "no-referrer"/);
  const read = await readFile("src/modules/store/order-read.ts", "utf8");
  const exists = read.slice(read.indexOf("export async function guestOrderExists"), read.indexOf("export async function currentOrderAgreement"));
  assert.match(exists, /owner_kind='guest'/);
  const page = await readFile("src/app/(store)/siparis/baglanti/page.tsx", "utf8");
  assert.match(page, /privatePageRobots/);
  assert.doesNotMatch(page, /@\/lib\/db|order-read/);
});

test("a signed link only reads guest orders and never reaches payment or order actions", async () => {
  const read = await readFile("src/modules/store/order-read.ts", "utf8");
  const viewable = read.slice(read.indexOf("export async function viewableOrder"), read.indexOf("export async function currentOrderAgreement"));
  assert.match(viewable, /FROM commerce_orders WHERE id=\$1 AND owner_kind='guest'/);
  assert.match(viewable, /verifyOrderLink\(/);
  const current = read.slice(read.indexOf("export async function currentOrder("), read.indexOf("export async function viewableOrder"));
  assert.doesNotMatch(current, /ORDER_LINK_COOKIE|verifyOrderLink|cookies\(/, "currentOrder ignores the link cookie");
  for (const file of ["src/app/(store)/siparis/[id]/actions.ts", "src/app/api/payments/tami/start/route.ts"]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /viewableOrder|ORDER_LINK_COOKIE|gb_order_link|order-link/, `${file} must stay owner/admin only`);
  }
});

test("a guest link replaces both order links and says until when it opens on any device", () => {
  const guestLink = { token: signOrderLink(linkOrder, new Date("2027-02-19T10:00:00Z"), linkSecret), expiresAt: new Date("2027-02-19T10:00:00Z") };
  const { text, html } = build({}, { guestLink });
  const access = `https://shop.example.invalid/siparis/${linkOrder}/erisim?t=${guestLink.token}`;
  assert.ok(text.includes(`Siparişini görüntüle: ${access}\n`));
  assert.ok(text.includes(`Sözleşme kopyan: ${access}&sayfa=sozlesme\n`));
  assert.ok(html.includes(`href="${access}"`));
  assert.ok(html.includes(`href="${access}&amp;sayfa=sozlesme"`));
  const note = "Bu bağlantılar 19 Şubat 2027 tarihine kadar her cihazda açılır. Siparişinin bilgilerini içerdiği için bu bağlantıları kimseyle paylaşma.";
  assert.ok(text.includes(note)); assert.ok(html.includes(note));
  assert.doesNotMatch(text, new RegExp(`/siparis/${linkOrder}(?:/sozlesme)?\\s`), "no bare order link");
  assert.doesNotMatch(html, new RegExp(`/siparis/${linkOrder}(?:/sozlesme)?"`), "no bare order link");
  assert.doesNotMatch(text, /siparişi verdiğin tarayıcıdan/);
  const plain = build();
  assert.ok(plain.text.includes("Sipariş sayfası, siparişi verdiğin hesapla ya da siparişi verdiğin tarayıcıdan açılır."));
  assert.doesNotMatch(plain.text, /erisim/);
});

test("shipping, discount, installments, a separate corporate invoice and the note are shown when present", () => {
  const { text, html } = build({
    shipping_kurus: "4990", discount_percent: 5, installment_count: 3, installment_fee_kurus: "12345", note: "Kapıda arayın",
    invoice_type: "corporate", invoice_company: "Örnek Ltd", invoice_tax_no: "1234567890", invoice_tax_office: "Kadıköy",
    invoice_province: "Ankara", invoice_district: "Çankaya", invoice_address_line: "Atatürk Bulvarı No 1", invoice_postal_code: "06690",
  }, { hasAgreement: false });
  for (const part of ["Kargo: ₺49,90", "Servis indirimi: %5 uygulandı", "Vade farkı (3 taksit): ₺123,45",
    "Fatura adresi\nAtatürk Bulvarı No 1, 06690 Çankaya/Ankara", "Fatura: Kurumsal · Örnek Ltd · Vergi/TC kimlik no 1234567890 · Kadıköy V.D.", "Not: Kapıda arayın"]) {
    assert.ok(text.includes(part), `text is missing: ${part}`);
  }
  assert.doesNotMatch(text, /Sözleşme kopyan|\/sozlesme/);
  assert.doesNotMatch(html, /\/sozlesme"/);
  assert.ok(html.includes("Vade farkı (3 taksit)"));
});

test("customer text is escaped in the HTML", () => {
  const attack = "<script>alert(1)</script>";
  const { html, text } = email.buildOrderConfirmation({
    order: { ...baseOrder, customer_name: `Ali ${attack}`, address: `Sokak "1" ${attack}`, note: `Not ${attack}`, invoice_type: "corporate",
      invoice_company: `<b>Firma</b>`, invoice_tax_no: "1234567890", invoice_tax_office: "X" },
    items: [{ name: `Parça ${attack}`, code: `<i>KOD</i>`, quantity: 1, unit_price_kurus: "1000" }], hasAgreement: false, baseUrl: "https://shop.example.invalid",
  });
  assert.doesNotMatch(html, /<script|<b>Firma|<i>KOD/);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Sokak &quot;1&quot;"));
  // Plain text keeps the customer's words as written; mail clients do not render it as HTML.
  assert.ok(text.includes(`Ali ${attack}`));
});

test("mail settings: unset, incomplete or production file transport send nothing", () => {
  assert.deepEqual(mail.mailConfig({}), { kind: "none", reason: "MAIL_TRANSPORT is not set" });
  assert.equal(mail.mailConfig({ MAIL_TRANSPORT: "carrier-pigeon", MAIL_FROM: "a@example.invalid" }).kind, "none");
  assert.deepEqual(mail.mailConfig({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example.invalid" }), { kind: "none", reason: "MAIL_FROM is missing" });
  assert.deepEqual(mail.mailConfig({ MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@example.invalid" }), { kind: "none", reason: "SMTP_HOST is missing" });
  assert.equal(mail.mailConfig({ MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@example.invalid", SMTP_HOST: "h", SMTP_USER: "u" }).kind, "none");
  assert.equal(mail.mailConfig({ MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@example.invalid", SMTP_HOST: "h", SMTP_PORT: "x" }).kind, "none");
  assert.deepEqual(mail.mailConfig({ MAIL_TRANSPORT: "file", MAIL_FROM: "a@example.invalid", NODE_ENV: "production" }),
    { kind: "none", reason: "MAIL_TRANSPORT=file is refused in production" });
  assert.deepEqual(mail.mailConfig({ MAIL_TRANSPORT: "file", MAIL_FROM: "a@example.invalid" }),
    { kind: "file", from: "a@example.invalid", replyTo: "hey@getirbakim.com", dir: ".local/mail" });
  assert.deepEqual(mail.mailConfig({ MAIL_TRANSPORT: "smtp", MAIL_FROM: "Getirbakim <siparis@example.invalid>", SMTP_HOST: "email-smtp.eu-central-1.amazonaws.com" }), {
    kind: "smtp", from: "Getirbakim <siparis@example.invalid>", replyTo: "hey@getirbakim.com", host: "email-smtp.eu-central-1.amazonaws.com",
    port: 587, secure: false, user: null, password: null,
  });
  const secure = mail.mailConfig({ MAIL_TRANSPORT: "smtp", MAIL_FROM: "a@example.invalid", MAIL_REPLY_TO: "r@example.invalid", SMTP_HOST: "h",
    SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USER: "u", SMTP_PASSWORD: "p" });
  assert.deepEqual(secure, { kind: "smtp", from: "a@example.invalid", replyTo: "r@example.invalid", host: "h", port: 465, secure: true, user: "u", password: "p" });
});

test("ses settings: region precedence, default and missing sender", () => {
  const base = { MAIL_TRANSPORT: "ses", MAIL_FROM: "Getirbakim <siparis@getirbakim.com>" };
  assert.deepEqual(mail.mailConfig({ MAIL_TRANSPORT: "ses" }), { kind: "none", reason: "MAIL_FROM is missing" });
  assert.deepEqual(mail.mailConfig(base), { kind: "ses", from: base.MAIL_FROM, replyTo: "hey@getirbakim.com", region: "eu-central-1" });
  assert.equal((mail.mailConfig({ ...base, AWS_REGION: "eu-west-1" }) as { region: string }).region, "eu-west-1");
  assert.equal((mail.mailConfig({ ...base, AWS_REGION: "eu-west-1", SES_REGION: "us-east-1", MAIL_REPLY_TO: "r@example.invalid" }) as { region: string; replyTo: string }).region, "us-east-1");
});

test("the ses transport sends raw MIME through the SESv2 client with our Message-ID", async () => {
  const { SESv2Client } = await import("@aws-sdk/client-sesv2");
  const original = SESv2Client.prototype.send;
  const inputs: { FromEmailAddress?: string; Destination?: { ToAddresses?: string[] }; Content?: { Raw?: { Data?: Uint8Array } } }[] = [];
  let failNext = false;
  (SESv2Client.prototype as { send: unknown }).send = async function (command: { input: (typeof inputs)[number] }) {
    inputs.push(command.input);
    if (failNext) throw Object.assign(new Error("MessageRejected"), { name: "MessageRejected" });
    return { MessageId: "ses-id-1" };
  };
  try {
    const config = { kind: "ses" as const, from: "Getirbakim <siparis@getirbakim.com>", replyTo: "hey@getirbakim.com", region: "eu-central-1" };
    const messageId = "<order-x-confirmation@shop.example.invalid>";
    assert.deepEqual(await mail.sendMail({ ...build(), to: "musteri@example.invalid", messageId }, config), { status: "sent", messageId });
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].FromEmailAddress, "Getirbakim <siparis@getirbakim.com>");
    assert.deepEqual(inputs[0].Destination?.ToAddresses, ["musteri@example.invalid"]);
    const raw = Buffer.from(inputs[0].Content?.Raw?.Data ?? []).toString("utf8");
    assert.match(raw, /^To: musteri@example\.invalid\r?$/m);
    assert.match(raw, /^Reply-To: hey@getirbakim\.com\r?$/m);
    assert.match(raw, /^Message-ID: <order-x-confirmation@shop\.example\.invalid>\r?$/m);
    failNext = true;
    await assert.rejects(mail.sendMail({ ...build(), to: "musteri@example.invalid", messageId }, config), /MessageRejected/);
  } finally {
    SESv2Client.prototype.send = original;
  }
});

test("an unconfigured transport skips without throwing", async () => {
  assert.deepEqual(await mail.sendMail({ to: "a@example.invalid", subject: "s", text: "t", html: "<p>t</p>" }, { kind: "none", reason: "off" }),
    { status: "skipped", reason: "off" });
});

test("the file transport writes a multipart .eml with an encoded Turkish subject", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "order-email-"));
  try {
    const content = build();
    const result = await mail.sendMail({ ...content, to: "musteri@example.invalid", messageId: "<order-x-confirmation@shop.example.invalid>" },
      { kind: "file", from: "Getirbakim <siparis@example.invalid>", replyTo: "hey@getirbakim.com", dir: path.join(dir, "nested") });
    assert.deepEqual(result, { status: "sent", messageId: "<order-x-confirmation@shop.example.invalid>" });
    const files = await readdir(path.join(dir, "nested"));
    assert.equal(files.length, 1); assert.match(files[0], /\.eml$/);
    const eml = await readFile(path.join(dir, "nested", files[0]), "utf8");
    assert.match(eml, /^To: musteri@example\.invalid$/m);
    assert.match(eml, /^Reply-To: hey@getirbakim\.com$/m);
    assert.match(eml, /^Subject: =\?UTF-8\?/m);
    assert.match(eml, /multipart\/alternative/);
    assert.match(eml, /^Message-ID: <order-x-confirmation@shop\.example\.invalid>$/m);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function paidOrder(ownerKind: "guest" | "account" = "guest") {
  const id = (await db.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,paid_at)
    VALUES($3,$1,$2,'Test Müşteri','musteri@example.invalid','5551234567','Test adres 1',20000,20000,0,'pending','paid',now()) RETURNING id::text`,
  [randomBytes(16).toString("hex"), randomUUID(), ownerKind])).rows[0].id;
  await db.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot)
    VALUES($1,$2,'X-1','Parça','demo',2,10000,'{"source":"store"}')`, [id, randomUUID()]);
  await email.queueOrderConfirmation(db, id);
  return id;
}
const outbox = async (id: string) => (await db.query<{ status: string; attempts: number; last_error: string | null; message_id: string | null; sent_at: Date | null }>(
  "SELECT status,attempts,last_error,message_id,sent_at FROM commerce_order_emails WHERE order_id=$1", [id])).rows;
const silence = async <T>(work: () => Promise<T>) => {
  const { info, error } = console;
  console.info = () => undefined; console.error = () => undefined;
  try { return await work(); } finally { console.info = info; console.error = error; }
};

test("concurrent deliveries send the confirmation once", async () => {
  const id = await paidOrder();
  await email.queueOrderConfirmation(db, id);
  assert.equal((await outbox(id)).length, 1);
  const sent: MailMessage[] = [];
  const send = async (message: MailMessage): Promise<MailResult> => {
    await new Promise(resolve => setTimeout(resolve, 50));
    sent.push(message); return { status: "sent", messageId: message.messageId ?? "" };
  };
  const results = await Promise.all([email.deliverOrderEmails({ orderId: id, send }), email.deliverOrderEmails({ orderId: id, send })]);
  assert.equal(sent.length, 1);
  assert.deepEqual(results.map(result => result.sent).sort(), [0, 1]);
  assert.equal(sent[0].to, "musteri@example.invalid");
  assert.equal(sent[0].subject, `Siparişini aldık — #${(await db.query("SELECT number::text FROM commerce_orders WHERE id=$1", [id])).rows[0].number}`);
  assert.equal(sent[0].messageId, `<order-${id}-confirmation@shop.example.invalid>`);
  assert.ok(sent[0].text.includes(`https://shop.example.invalid/siparis/${id}`));
  const [row] = await outbox(id);
  assert.equal(row.status, "sent"); assert.equal(row.attempts, 1); assert.equal(row.message_id, sent[0].messageId); assert.ok(row.sent_at);
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 0, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1);
});

test("without a mail transport the row is skipped and nothing throws", async () => {
  const id = await paidOrder();
  const result = await silence(() => email.deliverOrderEmails({ orderId: id, send: message => mail.sendMail(message, mail.mailConfig({})) }));
  assert.deepEqual(result, { sent: 0, skipped: 1, failed: 0 });
  const [row] = await outbox(id);
  assert.equal(row.status, "skipped"); assert.equal(row.last_error, "MAIL_TRANSPORT is not set");
});

test("a failed send backs off and stays pending until the day is over, then is given up", async () => {
  const id = await paidOrder();
  let calls = 0;
  const failing = async (): Promise<MailResult> => { calls++; throw Object.assign(new Error("421 try later for musteri@example.invalid"), { code: "EENVELOPE" }); };
  const run = () => silence(() => email.deliverOrderEmails({ orderId: id, send: failing }));
  // Moves the last claim back by `minutes`, as if that much time had passed.
  const age = (minutes: number) => db.query("UPDATE commerce_order_emails SET claimed_at=now()-make_interval(mins=>$2) WHERE order_id=$1", [id, minutes]);
  assert.deepEqual(await run(), { sent: 0, skipped: 0, failed: 0 });
  let [row] = await outbox(id);
  assert.equal(row.status, "pending"); assert.equal(row.attempts, 1); assert.match(row.last_error ?? "", /421 try later/);
  // Inside the first backoff (10 min) the row is not claimed again.
  await run();
  assert.equal(calls, 1);
  // Backoff grows per attempt: 10, 30, 90, 270 minutes, then 8 hours.
  for (const [attempts, wait] of [[1, 10], [2, 30], [3, 90], [4, 270], [5, 480], [6, 480]] as const) {
    await age(wait - 1); await run();
    assert.equal(calls, attempts, `attempt ${attempts + 1} waits ${wait} minutes`);
    await age(wait + 1); await run();
    assert.equal(calls, attempts + 1);
  }
  [row] = await outbox(id);
  // Seven failures (an outage of hours) still leave it pending, to be retried.
  assert.equal(row.status, "pending"); assert.equal(row.attempts, 7);
  await db.query("UPDATE commerce_order_emails SET created_at=now()-interval '25 hours' WHERE order_id=$1", [id]);
  await age(11);
  assert.deepEqual(await run(), { sent: 0, skipped: 0, failed: 1 });
  [row] = await outbox(id);
  assert.equal(row.status, "failed"); assert.match(row.last_error ?? "", /^stale after 7 attempts: 421 try later/);
  await age(600); await run();
  assert.equal(calls, 7);
});

test("an order cancelled or refunded before the send is not confirmed", async () => {
  let calls = 0;
  const send = async (message: MailMessage): Promise<MailResult> => { calls++; return { status: "sent", messageId: message.messageId ?? "" }; };
  for (const [status, payment] of [["cancelled", "refund_required"], ["cancelled", "refunded"], ["confirmed", "paid"]]) {
    const id = await paidOrder();
    await db.query("UPDATE commerce_orders SET status=$2,payment_status=$3 WHERE id=$1", [id, status, payment]);
    assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 0, skipped: 1, failed: 0 });
    const [row] = await outbox(id);
    assert.equal(row.status, "skipped"); assert.equal(row.last_error, "order no longer pending");
  }
  assert.equal(calls, 0);
});

test("a confirmation never tried within a day is skipped as stale, not sent", async () => {
  const id = await paidOrder();
  await db.query("UPDATE commerce_order_emails SET created_at=now()-interval '25 hours' WHERE order_id=$1", [id]);
  let calls = 0;
  assert.deepEqual(await email.deliverOrderEmails({ send: async message => { calls++; return { status: "sent", messageId: message.messageId ?? "" }; } }),
    { sent: 0, skipped: 0, failed: 0 });
  const [row] = await outbox(id);
  assert.equal(row.status, "skipped"); assert.equal(row.last_error, "stale");
  // Only the stale row was pending here, besides rows the earlier tests already settled.
  assert.equal(calls, 0);
});

test("deliverOrderEmailsSafely never throws", async () => {
  const id = await paidOrder();
  const result = await silence(() => email.deliverOrderEmailsSafely({ orderId: "not-a-uuid", send: async () => { throw new Error("x"); } }));
  assert.equal(result, null);
  assert.equal((await outbox(id))[0].status, "pending");
  await db.query("DELETE FROM commerce_order_emails WHERE order_id=$1", [id]);
});

// Admin resend (#1035): requeueOrderEmail puts a row back in the queue; delivery still decides whether it goes out.
async function admin() {
  return (await db.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Yönetici',$1,'x','admin',true) RETURNING id::text",
    [`admin-${randomBytes(6).toString("hex")}@example.invalid`])).rows[0].id;
}
const requeued = async (id: string) => (await db.query<{ requeued_at: Date | null; requeued_by: string | null; claimed_at: Date | null }>(
  "SELECT requeued_at,requeued_by::text,claimed_at FROM commerce_order_emails WHERE order_id=$1", [id])).rows[0];
const recorder = () => {
  const sent: MailMessage[] = [];
  return { sent, send: async (message: MailMessage): Promise<MailResult> => { sent.push(message); return { status: "sent", messageId: message.messageId ?? "" }; } };
};
const resendId = (id: string) => new RegExp(`^<order-${id}-confirmation-r\\d+@shop\\.example\\.invalid>$`);

test("a guest order's email carries a signed link when a secret is set; account orders and no secret keep the plain link", async () => {
  const { sent, send } = recorder();
  const guestPlain = await paidOrder();
  await email.deliverOrderEmails({ orderId: guestPlain, send });
  assert.ok(sent[0].text.includes(`Siparişini görüntüle: https://shop.example.invalid/siparis/${guestPlain}\n`), "no secret: plain link");
  process.env[orderLinkSecretEnv] = linkSecret;
  try {
    const guest = await paidOrder(), account = await paidOrder("account");
    await email.deliverOrderEmails({ orderId: guest, send });
    await email.deliverOrderEmails({ orderId: account, send });
    const token = new RegExp(`/siparis/${guest}/erisim\\?t=([0-9]+\\.[A-Za-z0-9_-]+)\n`).exec(sent[1].text)?.[1];
    assert.ok(token, "guest email has the signed link");
    assert.equal(verifyOrderLink(guest, token, linkSecret), true);
    const days = (Number(token.split(".")[0]) * 1000 - Date.now()) / 86_400_000;
    assert.ok(days > 89.9 && days <= 90, `expires in 90 days, got ${days}`);
    assert.ok(sent[2].text.includes(`Siparişini görüntüle: https://shop.example.invalid/siparis/${account}\n`), "account order: plain link");
    assert.doesNotMatch(sent[2].text, /erisim/);
  } finally {
    delete process.env[orderLinkSecretEnv];
  }
});

test("a given-up email is requeued with a fresh day and sent with a resend Message-ID", async () => {
  const id = await paidOrder(), adminId = await admin();
  await db.query(`UPDATE commerce_order_emails SET status='failed',attempts=7,claimed_at=now()-interval '2 hours',created_at=now()-interval '25 hours',
    last_error='stale after 7 attempts: 421' WHERE order_id=$1`, [id]);
  // The order number comes back for the list's alert.
  assert.equal(await email.requeueOrderEmail(id, "confirmation", adminId), (await db.query("SELECT number::text FROM commerce_orders WHERE id=$1", [id])).rows[0].number);
  const [row] = await outbox(id);
  assert.equal(row.status, "pending"); assert.equal(row.attempts, 0); assert.equal(row.last_error, null);
  const meta = await requeued(id);
  assert.ok(meta.requeued_at); assert.equal(meta.requeued_by, adminId); assert.equal(meta.claimed_at, null);
  const { sent, send } = recorder();
  // The row is 25 hours old, but the day counts from the resend: it is sent, not given up.
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1); assert.match(sent[0].messageId ?? "", resendId(id));
  const [after] = await outbox(id);
  assert.equal(after.status, "sent"); assert.equal(after.attempts, 1); assert.equal(after.message_id, sent[0].messageId);
});

test("a sent email is sent again once after a resend", async () => {
  const id = await paidOrder(), adminId = await admin();
  const { sent, send } = recorder();
  await email.deliverOrderEmails({ orderId: id, send });
  assert.equal(sent[0].messageId, `<order-${id}-confirmation@shop.example.invalid>`);
  // A resend within a minute of the send is refused (a double click from two tabs).
  assert.equal(await email.requeueOrderEmail(id, "confirmation", adminId), null);
  assert.equal((await requeued(id)).requeued_at, null);
  await db.query("UPDATE commerce_order_emails SET sent_at=now()-interval '2 minutes' WHERE order_id=$1", [id]);
  assert.equal(typeof await email.requeueOrderEmail(id, "confirmation", adminId), "string");
  const results = await Promise.all([email.deliverOrderEmails({ orderId: id, send }), email.deliverOrderEmails({ orderId: id, send })]);
  assert.deepEqual(results.map(result => result.sent).sort(), [0, 1]);
  assert.equal(sent.length, 2); assert.match(sent[1].messageId ?? "", resendId(id));
  assert.equal((await outbox(id))[0].status, "sent");
});

test("a skipped email (no transport) is sent after a resend once mail works", async () => {
  const id = await paidOrder(), adminId = await admin();
  await silence(() => email.deliverOrderEmails({ orderId: id, send: message => mail.sendMail(message, mail.mailConfig({})) }));
  assert.equal((await outbox(id))[0].status, "skipped");
  assert.equal(typeof await email.requeueOrderEmail(id, "confirmation", adminId), "string");
  const { sent, send } = recorder();
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1);
});

test("an email claimed within the lease is not requeued; an older claim is, and is tried at once", async () => {
  const id = await paidOrder(), adminId = await admin();
  await db.query("UPDATE commerce_order_emails SET attempts=1,claimed_at=now()-interval '1 minute',last_error='421' WHERE order_id=$1", [id]);
  assert.equal(await email.requeueOrderEmail(id, "confirmation", adminId), null);
  let [row] = await outbox(id);
  assert.equal(row.attempts, 1); assert.equal(row.last_error, "421"); assert.equal((await requeued(id)).requeued_at, null);
  await db.query("UPDATE commerce_order_emails SET claimed_at=now()-interval '11 minutes' WHERE order_id=$1", [id]);
  assert.equal(typeof await email.requeueOrderEmail(id, "confirmation", adminId), "string");
  const { sent, send } = recorder();
  // Without the resend the backoff after the first attempt (10 min) would allow this too; attempts=0 and no claim make it immediate.
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 1, skipped: 0, failed: 0 });
  [row] = await outbox(id);
  assert.equal(row.status, "sent"); assert.equal(row.attempts, 1); assert.equal(sent.length, 1);
});

test("a resend of an order that no longer waits for confirmation is refused and leaves the row as it was", async () => {
  const adminId = await admin();
  const { sent, send } = recorder();
  for (const [status, payment] of [["confirmed", "paid"], ["cancelled", "refund_required"], ["pending", "refunded"]]) {
    const id = await paidOrder();
    await email.deliverOrderEmails({ orderId: id, send });
    await db.query("UPDATE commerce_order_emails SET sent_at=now()-interval '2 minutes' WHERE order_id=$1", [id]);
    await db.query("UPDATE commerce_orders SET status=$2,payment_status=$3 WHERE id=$1", [id, status, payment]);
    assert.equal(await email.requeueOrderEmail(id, "confirmation", adminId), null);
    const [row] = await outbox(id);
    assert.equal(row.status, "sent"); assert.equal(row.attempts, 1); assert.equal((await requeued(id)).requeued_at, null);
    assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 0, skipped: 0, failed: 0 });
  }
  // Only the three first sends went out.
  assert.equal(sent.length, 3);
});

test("an unknown order or kind is not requeued", async () => {
  const adminId = await admin();
  assert.equal(await email.requeueOrderEmail(randomUUID(), "confirmation", adminId), null);
  const id = await paidOrder();
  assert.equal(await email.requeueOrderEmail(id, "bogus" as "confirmation", adminId), null);
});

test("a requeued email is given up a day after the resend", async () => {
  const id = await paidOrder(), adminId = await admin();
  await db.query("UPDATE commerce_order_emails SET status='skipped',last_error='stale',created_at=now()-interval '3 days' WHERE order_id=$1", [id]);
  assert.equal(typeof await email.requeueOrderEmail(id, "confirmation", adminId), "string");
  await db.query("UPDATE commerce_order_emails SET requeued_at=now()-interval '25 hours' WHERE order_id=$1", [id]);
  let calls = 0;
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send: async message => { calls++; return { status: "sent", messageId: message.messageId ?? "" }; } }),
    { sent: 0, skipped: 0, failed: 0 });
  const [row] = await outbox(id);
  assert.equal(row.status, "skipped"); assert.equal(row.last_error, "stale"); assert.equal(calls, 0);
});

test("admin labels and the resend rule", () => {
  assert.equal(orderEmailErrorLabel("stale"), "Bir gün içinde gönderilemedi");
  assert.equal(orderEmailErrorLabel("order no longer pending"), "Sipariş durumu değişti; bu e-posta artık gönderilmez");
  for (const reason of ["MAIL_TRANSPORT is not set", "MAIL_FROM is missing", "SMTP_HOST is missing", "unknown MAIL_TRANSPORT x", "MAIL_TRANSPORT=file is refused in production"]) {
    assert.equal(orderEmailErrorLabel(reason), "E-posta gönderimi ayarlı değil", reason);
  }
  assert.equal(orderEmailErrorLabel("stale after 7 attempts: 421 try later"), "7 denemeden sonra bırakıldı: 421 try later");
  assert.equal(orderEmailErrorLabel("421 try later"), "Son hata: 421 try later");
  const waiting = { status: "pending", payment_status: "paid" };
  assert.equal(orderEmailDue.confirmation(waiting), true);
  for (const order of [{ status: "confirmed", payment_status: "paid" }, { status: "pending", payment_status: "unpaid" }, { status: "cancelled", payment_status: "refunded" }]) {
    assert.equal(orderEmailDue.confirmation(order), false, JSON.stringify(order));
    assert.equal(canResendOrderEmail({ kind: "confirmation", in_flight: false }, order), false);
  }
  assert.equal(canResendOrderEmail({ kind: "confirmation", in_flight: false }, waiting), true);
  assert.equal(canResendOrderEmail({ kind: "confirmation", in_flight: true }, waiting), false);
});

// Status emails (#1036): shipped, cancelled and refunded.
const statusOrder: StatusOrder = {
  id: baseOrder.id, number: "1042", customer_name: "Ayşe Yılmaz", phone: "0555 123 45 67", address: "Moda Cad. No 1, 34710 Kadıköy/İstanbul",
  carrier: "yurtici", carrier_name: null, tracking_no: "123456789012", tracking_url: "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=123456789012",
  cancelled_by: "admin", payment_status: "paid",
};
const statusBase = "https://shop.example.invalid/";
const shipped = (order: Partial<StatusOrder> = {}) => email.buildOrderShipped({ order: { ...statusOrder, ...order }, baseUrl: statusBase });
const cancelled = (order: Partial<StatusOrder> = {}) => email.buildOrderCancelled({ order: { ...statusOrder, ...order }, baseUrl: statusBase });
const refunded = (refundKurus: number | null, order: Partial<StatusOrder> = {}, card = true) =>
  email.buildOrderRefunded({ order: { ...statusOrder, payment_status: "refunded", ...order }, baseUrl: statusBase, refundKurus, card });
const has = (content: { text: string; html: string }, ...parts: string[]) => {
  for (const part of parts) assert.ok(content.text.includes(part), `text is missing: ${part}`);
};

test("the shipped email names the carrier, the tracking number and link, and the delivery address", () => {
  const content = shipped();
  assert.equal(content.subject, "Siparişin kargoya verildi — #1042");
  has(content, "Merhaba Ayşe Yılmaz,", "Siparişini Yurtiçi Kargo ile kargoya verdik.", "Takip numarası: 123456789012",
    `Kargonu takip et: ${statusOrder.tracking_url}`, "Sipariş no: #1042",
    "Teslimat adresi\nAyşe Yılmaz\n0555 123 45 67\nModa Cad. No 1, 34710 Kadıköy/İstanbul",
    `Siparişini görüntüle: https://shop.example.invalid/siparis/${baseOrder.id}\n`,
    "Sipariş sayfası, siparişi verdiğin hesapla ya da siparişi verdiğin tarayıcıdan açılır.", "hey@getirbakim.com");
  assert.ok(content.html.includes("Siparişin yola çıktı"));
  assert.ok(content.html.includes(`href="https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=123456789012"`));
  assert.doesNotMatch(content.text, /kargo firmasının sitesinden|sozlesme|Mesafeli satış/);
  assert.ok(content.html.includes(`Takip numarası: <strong style="font-weight:600;">123456789012</strong>`));
  // Only an http(s) address becomes a link.
  for (const url of ["javascript:alert(1)", "data:text/html,x", "not a url"]) {
    const odd = shipped({ tracking_url: url });
    assert.doesNotMatch(odd.text, /Kargonu takip et/, url);
    assert.ok(!odd.html.includes(`href="${url}"`), url);
    has(odd, "Takip numaranla kargo firmasının sitesinden sorgulayabilirsin.");
  }
  assert.doesNotMatch(content.text, /<[a-z/][^>]*>/i, "text has no tags");
  // No query link for the carrier: the customer is told where to search.
  const ptt = shipped({ carrier: "ptt", tracking_url: null });
  has(ptt, "Siparişini PTT Kargo ile kargoya verdik.", "Takip numarası: 123456789012", "Takip numaranla kargo firmasının sitesinden sorgulayabilirsin.");
  assert.doesNotMatch(ptt.text, /Kargonu takip et/);
  // A free carrier name for 'other'.
  has(shipped({ carrier: "other", carrier_name: "Yerel Kurye", tracking_url: null }), "Siparişini Yerel Kurye ile kargoya verdik.");
  // Shipped before #605: no carrier recorded.
  const legacy = shipped({ carrier: null, tracking_no: null, tracking_url: null });
  has(legacy, "Siparişini kargoya verdik.", "Takip numarası belli olduğunda sipariş sayfanda görünecek.");
  assert.doesNotMatch(legacy.text, /Takip numarası:/);
});

test("the cancel email says who cancelled and, for a paid order, that the payment comes back", () => {
  const byAdmin = cancelled({ payment_status: "refund_required" });
  assert.equal(byAdmin.subject, "Siparişin iptal edildi — #1042");
  has(byAdmin, "Siparişini iptal etmek zorunda kaldık. Bunun için özür dileriz.", "Ödemenin tamamı iade edilecek; iade tamamlandığında sana ayrıca e-posta göndereceğiz.");
  // Already refunded when sent: past tense, no promise of another email.
  const byCustomer = cancelled({ cancelled_by: "customer", payment_status: "refunded" });
  has(byCustomer, "Talebin üzerine siparişini iptal ettik.", "Ödemenin tamamı iade edildi.");
  assert.doesNotMatch(byCustomer.text, /zorunda kaldık|iade edilecek|ayrıca e-posta/);
  // A legacy offline order was never charged online: no payment sentence.
  const offline = cancelled({ payment_status: "none" });
  assert.doesNotMatch(offline.text, /iade/);
  assert.doesNotMatch(offline.text, /Teslimat adresi|Takip/);
});

test("the refund email stands alone, with the amount when known", () => {
  const content = refunded(20000);
  assert.equal(content.subject, "Ödemen iade edildi — #1042");
  has(content, "#1042 numaralı siparişinin ödemesini iade ettik.", "İade tutarı: ₺200,00",
    "İadenin kartına yansıması bankana bağlı olarak birkaç iş günü sürebilir.", "Sipariş no: #1042");
  assert.ok(content.html.includes("Ödemen iade edildi"));
  // No reliable amount: no amount line and no claim that the whole payment came back.
  for (const amount of [null, 0]) {
    const unknown = refunded(amount);
    has(unknown, "#1042 numaralı siparişin için ödeme iadesi yaptık.", "kartına yansıması");
    assert.doesNotMatch(unknown.text, /İade tutarı|ödemesini iade ettik/);
  }
  // Recorded by hand (no TAMI reversal): no card wording.
  const manual = refunded(null, {}, false);
  has(manual, "İade, ödemeyi yaptığın yönteme göre birkaç iş günü içinde hesabına yansır.");
  assert.doesNotMatch(manual.text, /kartına/);
});

test("status emails escape customer text and carry the signed guest link with its dated note", () => {
  const attack = "<script>alert(1)</script>";
  const evil = { customer_name: `Ali ${attack}`, address: `Sokak "1" ${attack}`, carrier: "other", carrier_name: `<b>Kurye</b>`,
    tracking_no: `<i>NO</i>`, tracking_url: `https://example.invalid/?a=1&b="x"` };
  for (const content of [shipped(evil), cancelled(evil), refunded(100, evil)]) {
    assert.doesNotMatch(content.html, /<script|<b>Kurye|<i>NO/);
    assert.ok(content.html.includes("Ali &lt;script&gt;alert(1)&lt;/script&gt;"));
  }
  assert.ok(shipped(evil).html.includes(`href="https://example.invalid/?a=1&amp;b=&quot;x&quot;"`));
  const expiresAt = new Date("2027-02-19T10:00:00Z");
  const guestLink = { token: signOrderLink(linkOrder, expiresAt, linkSecret), expiresAt };
  const access = `https://shop.example.invalid/siparis/${linkOrder}/erisim?t=${guestLink.token}`;
  const note = "Bu bağlantı 19 Şubat 2027 tarihine kadar her cihazda açılır. Siparişinin bilgilerini içerdiği için bu bağlantıyı kimseyle paylaşma.";
  for (const content of [
    email.buildOrderShipped({ order: statusOrder, baseUrl: statusBase, guestLink }),
    email.buildOrderCancelled({ order: statusOrder, baseUrl: statusBase, guestLink }),
    email.buildOrderRefunded({ order: statusOrder, baseUrl: statusBase, guestLink, refundKurus: 100 }),
  ]) {
    assert.ok(content.text.includes(`Siparişini görüntüle: ${access}\n`));
    assert.ok(content.html.includes(`href="${access}"`));
    assert.ok(content.text.includes(note)); assert.ok(content.html.includes(note));
    assert.doesNotMatch(content.text, new RegExp(`/siparis/${linkOrder}\\s`), "no bare order link");
    assert.doesNotMatch(content.text, /sozlesme|Mesafeli satış|Ön bilgilendirme/, "no contract links");
  }
});

async function placedOrder({ owner = "guest", status = "confirmed", payment = "paid" }: { owner?: "guest" | "account" | "partner"; status?: string; payment?: string } = {}) {
  return (await db.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,paid_at)
    VALUES($3,$1,$2,'Test Müşteri','musteri@example.invalid','5551234567','Test adres 1',20000,20000,0,$4,$5,CASE WHEN $5 IN ('paid','refund_required') THEN now() END) RETURNING id::text`,
  [randomBytes(16).toString("hex"), randomUUID(), owner, status, payment])).rows[0].id;
}
const kinds = async (id: string) => (await db.query<{ kind: string }>("SELECT kind FROM commerce_order_emails WHERE order_id=$1 ORDER BY kind", [id])).rows.map(r => r.kind);
const shipment = { carrier: "yurtici" as const, carrierName: null, trackingNo: "123456789012", trackingUrl: null };
async function lockedCancel(id: string, by: "customer" | "admin" | "expiry") {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM commerce_orders WHERE id=$1 FOR UPDATE", [id]);
    await orderCancel.cancelLockedOrder(client, id, by);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

test("shipping queues the shipped email once; a refused or repeated step queues nothing more", async () => {
  const id = await placedOrder();
  assert.equal(await adminOrders.shipOrder(id, shipment), true);
  assert.deepEqual(await kinds(id), ["shipped"]);
  assert.equal(await adminOrders.shipOrder(id, shipment), false);
  assert.equal(await adminOrders.updateShipment(id, { ...shipment, trackingNo: "123456789013" }), true);
  assert.deepEqual(await kinds(id), ["shipped"]);
  const pending = await placedOrder({ status: "pending" });
  assert.equal(await adminOrders.shipOrder(pending, shipment), false);
  assert.deepEqual(await kinds(pending), []);
});

test("a cancel queues the cancel email only for an accepted order", async () => {
  const paidByAdmin = await placedOrder({ status: "pending" });
  assert.equal(await adminOrders.transitionOrder(paidByAdmin, "cancelled"), true);
  assert.deepEqual(await kinds(paidByAdmin), ["cancelled"]);
  const paidByCustomer = await placedOrder({ status: "pending" });
  await lockedCancel(paidByCustomer, "customer");
  assert.deepEqual(await kinds(paidByCustomer), ["cancelled"]);
  // Legacy offline order: accepted without an online payment.
  const offline = await placedOrder({ payment: "none" });
  await lockedCancel(offline, "admin");
  assert.deepEqual(await kinds(offline), ["cancelled"]);
  // Unpaid: the customer's own cancel and the payment window's expiry write to nobody.
  const unpaid = await placedOrder({ status: "awaiting_payment", payment: "awaiting" });
  await lockedCancel(unpaid, "customer");
  const expired = await placedOrder({ status: "awaiting_payment", payment: "awaiting" });
  await lockedCancel(expired, "expiry");
  assert.equal((await db.query("SELECT payment_status FROM commerce_orders WHERE id=$1", [expired])).rows[0].payment_status, "expired");
  assert.deepEqual([await kinds(unpaid), await kinds(expired)], [[], []]);
});

test("partner orders get no status email", async () => {
  const id = await placedOrder({ owner: "partner", payment: "none" });
  assert.equal(await adminOrders.shipOrder(id, shipment), true);
  const cancelledPartner = await placedOrder({ owner: "partner", payment: "none" });
  await lockedCancel(cancelledPartner, "customer");
  assert.deepEqual([await kinds(id), await kinds(cancelledPartner)], [[], []]);
});

test("a recorded refund queues the refund email with the payment change, once", async () => {
  const id = await placedOrder({ status: "cancelled", payment: "refund_required" });
  assert.equal(await adminOrders.recordOrderRefund(id, "TAMI-REF-1"), true);
  assert.deepEqual(await kinds(id), ["refunded"]);
  assert.equal(await adminOrders.recordOrderRefund(id, "TAMI-REF-2"), false);
  const notDue = await placedOrder();
  assert.equal(await adminOrders.recordOrderRefund(notDue, "TAMI-REF-3"), false);
  assert.deepEqual(await kinds(notDue), []);
  // The refund email and its order change commit together: a failing queue rolls the refund back.
  const atomic = await placedOrder({ status: "cancelled", payment: "refund_required" });
  await db.query("ALTER TABLE commerce_order_emails ADD CONSTRAINT order_emails_test_block CHECK (kind<>'refunded') NOT VALID");
  try { await assert.rejects(adminOrders.recordOrderRefund(atomic, "TAMI-REF-4")); }
  finally { await db.query("ALTER TABLE commerce_order_emails DROP CONSTRAINT order_emails_test_block"); }
  assert.equal((await db.query("SELECT payment_status FROM commerce_orders WHERE id=$1", [atomic])).rows[0].payment_status, "refund_required");
});

test("status emails are delivered with their kind in the Message-ID and the refunded amount", async () => {
  const { sent, send } = recorder();
  const id = await placedOrder();
  await adminOrders.shipOrder(id, shipment);
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent[0].messageId, `<order-${id}-shipped@shop.example.invalid>`);
  assert.match(sent[0].subject, /^Siparişin kargoya verildi — #\d+$/);
  assert.ok(sent[0].text.includes("Siparişini Yurtiçi Kargo ile kargoya verdik."));
  const refund = await placedOrder({ status: "pending" });
  await adminOrders.transitionOrder(refund, "cancelled");
  const payment = (await db.query<{ id: string }>(`INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status,hosted_url,paid_at)
    VALUES($1,$2,20000,'succeeded','https://example.invalid/pay',now()) RETURNING id::text`, [refund, `GB2-${randomBytes(4).toString("hex")}`])).rows[0].id;
  await db.query(`INSERT INTO commerce_payment_refunds(payment_id,order_id,kind,amount_kurus,status,correlation_id,completed_at)
    VALUES($1,$2,'refund',20000,'succeeded',$3,now())`, [payment, refund, randomUUID()]);
  await adminOrders.recordOrderRefund(refund, "TAMI-REF-5");
  assert.deepEqual(await email.deliverOrderEmails({ orderId: refund, send }), { sent: 2, skipped: 0, failed: 0 });
  const [cancelMail, refundMail] = sent.slice(1);
  assert.equal(cancelMail.messageId, `<order-${refund}-cancelled@shop.example.invalid>`);
  assert.ok(cancelMail.text.includes("Siparişini iptal etmek zorunda kaldık."));
  assert.equal(refundMail.messageId, `<order-${refund}-refunded@shop.example.invalid>`);
  assert.ok(refundMail.text.includes("İade tutarı: ₺200,00"));
});

test("a status email whose order moved on is skipped, and a resend follows the kind's rule", async () => {
  const { sent, send } = recorder();
  const adminId = await admin();
  const id = await placedOrder();
  await adminOrders.shipOrder(id, shipment);
  await adminOrders.transitionOrder(id, "delivered");
  assert.deepEqual(await email.deliverOrderEmails({ orderId: id, send }), { sent: 0, skipped: 1, failed: 0 });
  assert.equal((await outbox(id))[0].last_error, "order no longer pending");
  assert.equal(await email.requeueOrderEmail(id, "shipped", adminId), null);
  // Still shipped: the resend goes out with a resend Message-ID.
  const onTheWay = await placedOrder();
  await adminOrders.shipOrder(onTheWay, shipment);
  await email.deliverOrderEmails({ orderId: onTheWay, send });
  await db.query("UPDATE commerce_order_emails SET sent_at=now()-interval '2 minutes' WHERE order_id=$1", [onTheWay]);
  assert.equal(typeof await email.requeueOrderEmail(onTheWay, "shipped", adminId), "string");
  await email.deliverOrderEmails({ orderId: onTheWay, send });
  assert.equal(sent.length, 2);
  assert.match(sent[1].messageId ?? "", new RegExp(`^<order-${onTheWay}-shipped-r\\d+@shop\\.example\\.invalid>$`));
});

test("every kind has a due rule, an admin label and a not-due reason", () => {
  for (const kind of orderEmailKinds) {
    assert.equal(typeof orderEmailDue[kind], "function");
    assert.ok(orderEmailNotDueLabel[kind].endsWith("bu e-posta yeniden gönderilmez."), kind);
  }
  assert.equal(orderEmailDue.shipped({ status: "shipped", payment_status: "paid" }), true);
  assert.equal(orderEmailDue.shipped({ status: "delivered", payment_status: "paid" }), false);
  assert.equal(orderEmailDue.cancelled({ status: "cancelled", payment_status: "refunded" }), true);
  assert.equal(orderEmailDue.refunded({ status: "cancelled", payment_status: "refunded" }), true);
  assert.equal(orderEmailDue.refunded({ status: "cancelled", payment_status: "refund_required" }), false);
});

async function capture(orderId: string) {
  return (await db.query<{ id: string }>(`INSERT INTO commerce_payments(order_id,provider_order_id,amount_kurus,status,hosted_url,paid_at)
    VALUES($1,$2,20000,'succeeded','https://example.invalid/pay',now()-interval '2 hours') RETURNING id::text`, [orderId, `GB2-${randomBytes(4).toString("hex")}`])).rows[0].id;
}
const reversal = (paymentId: string, orderId: string, completed: string) => db.query(`INSERT INTO commerce_payment_refunds(payment_id,order_id,kind,amount_kurus,status,correlation_id,completed_at)
  VALUES($1,$2,'refund',20000,'succeeded',$3,now()+$4::interval)`, [paymentId, orderId, randomUUID(), completed]);

test("the refund amount counts only this refund and only when every capture was reversed", async () => {
  const { sent, send } = recorder();
  const refundMail = async (id: string) => {
    await adminOrders.recordOrderRefund(id, "TAMI-REF");
    await email.deliverOrderEmails({ orderId: id, send });
    return sent.find(message => message.messageId === `<order-${id}-refunded@shop.example.invalid>`)?.text ?? "";
  };
  // A duplicate capture reversed while the order was still paid, then the cancel's refund of the other capture.
  const duplicate = await placedOrder({ status: "pending" });
  const [extra, kept] = [await capture(duplicate), await capture(duplicate)];
  await reversal(extra, duplicate, "-1 hour");
  await adminOrders.transitionOrder(duplicate, "cancelled");
  await reversal(kept, duplicate, "1 second");
  const text = await refundMail(duplicate);
  assert.ok(text.includes("İade tutarı: ₺200,00"), text);
  assert.ok(text.includes("kartına yansıması"));
  // One capture refunded elsewhere (no reversal row): the amount is not known, so it is left out.
  const partial = await placedOrder({ status: "pending" });
  const first = await capture(partial);
  await capture(partial);
  await adminOrders.transitionOrder(partial, "cancelled");
  await reversal(first, partial, "1 second");
  const partialText = await refundMail(partial);
  assert.doesNotMatch(partialText, /İade tutarı/);
  assert.ok(partialText.includes("numaralı siparişin için ödeme iadesi yaptık.") && partialText.includes("kartına yansıması"));
  // Recorded by hand only: no amount, no card wording.
  const manual = await placedOrder({ status: "pending" });
  await capture(manual);
  await adminOrders.transitionOrder(manual, "cancelled");
  const manualText = await refundMail(manual);
  assert.doesNotMatch(manualText, /İade tutarı|kartına/);
  assert.ok(manualText.includes("İade, ödemeyi yaptığın yönteme göre birkaç iş günü içinde hesabına yansır."));
});
