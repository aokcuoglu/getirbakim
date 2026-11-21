import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import type { MailMessage, MailResult } from "../src/lib/mail";
import type { ConfirmationData } from "../src/modules/store/order-email";
import { canResendOrderEmail, orderEmailDue, orderEmailErrorLabel } from "../src/modules/store/order-email-state";
import { ORDER_LINK_COOKIE, ORDER_LINK_DAYS, orderLinkGrant, orderLinkPath, orderLinkSecret, orderLinkSecretEnv, orderLinkToken, signOrderLink, verifyOrderLink } from "../src/modules/store/order-link";

// Order confirmation email (#951): content, mail settings, the .eml file transport and the outbox in a throwaway
// schema (db/schema.sql + db/commerce.sql applied twice). No mail leaves the machine: sends are injected or written to a temp dir.
const originalUrl = process.env.DATABASE_URL;
const originalSite = process.env.SITE_URL;
const originalLinkSecret = process.env[orderLinkSecretEnv];
let root: Pool, control: PoolClient, namespace = "";
let mail: typeof import("../src/lib/mail");
let email: typeof import("../src/modules/store/order-email");
let db: typeof import("../src/lib/db").db;

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
  assert.equal(await email.requeueOrderEmail(id, "shipped" as "confirmation", adminId), null);
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
  assert.equal(orderEmailErrorLabel("order no longer pending"), "Sipariş artık teyit beklemiyor (onaylandı, iptal ya da iade edildi)");
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
