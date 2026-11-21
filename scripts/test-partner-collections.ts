import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";

// Collections against partner invoices (#1006) in an isolated copy of the schema: partial and full payments, the
// "active collected ≤ invoice total" invariant across payments, voids, invoice corrections and undos (whole invoice and
// single order), the partner lock, the table's CHECKs, the pure status rules and the /yonetim actions.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let limits: typeof import("../src/modules/partner/limits");
let collections: typeof import("../src/modules/partner/collections");
let actions: typeof import("../src/modules/admin/partner-actions");
let adminPartners: typeof import("../src/modules/admin/partners");
let input: typeof import("../src/modules/admin/partner-input");
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
const day = "2026-11-15";
const newRef = () => `F-${randomUUID().slice(0, 8)}`;

/** A delivered partner order, invoiced under `ref` on `day` unless ref is null. */
async function order(totalKurus: number, ref: string | null, invoiceDay = day, partner = "bakimx") {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,delivered_at,partner_invoiced_at,partner_invoice_ref,partner_invoiced_by)
    VALUES('partner',$1,gen_random_uuid(),'Usta Oto','p@example.invalid','5551234567','Adres',$2,$2,0,'delivered','on_account','2026-11-10T10:00:00Z',
     CASE WHEN $3::text IS NULL THEN NULL ELSE ($4::date)::timestamp AT TIME ZONE 'Europe/Istanbul' END,$3,CASE WHEN $3::text IS NULL THEN NULL ELSE $5::uuid END)
    RETURNING id::text`, [partner, totalKurus, ref, invoiceDay, admin]);
  return rows[0].id;
}
const pay = (invoiceRef: string, amountKurus: number, expected: { totalKurus: number; collectedKurus: number }, invoiceDate = day, partner = "bakimx") =>
  collections.recordInvoicePayment({ partner, invoiceRef, invoiceDate, amountKurus, paidOn: "2026-11-16", method: "bank_transfer", note: "", adminId: admin, expected });
const ledgerOf = async (invoiceRef: string, invoiceDate = day) =>
  (await collections.partnerInvoiceLedger(["bakimx"])).find(invoice => invoice.invoiceRef === invoiceRef && invoice.invoiceDate === invoiceDate);
const paymentRows = async () => (await schema.pool.query<{ id: string; invoice_ref: string; invoice_day: string; amount_kurus: string; voided: boolean }>(
  "SELECT id::text,invoice_ref,to_char(invoice_day,'YYYY-MM-DD') AS invoice_day,amount_kurus::text,voided_at IS NOT NULL AS voided FROM partner_invoice_payments ORDER BY id")).rows;
const undoInvoice = (invoiceRef: string, count: number, totalKurus: number) =>
  limits.changePartnerInvoice({ partner: "bakimx", invoiceRef, invoiceDate: day, action: "undo", reason: "Yanlış işaretlendi", adminId: admin, expected: { count, totalKurus } });
const undoOrder = (orderId: string, invoiceRef: string) =>
  limits.undoPartnerOrderInvoice({ orderId, reason: "Bu sipariş faturaya girmedi", adminId: admin, expected: { invoiceRef, invoiceDate: day } });

before(async () => {
  schema = await isolatedSchema("partner_collections_test");
  process.env.PARTNER_API_KEYS = `bakimx:${"k".repeat(24)}`;
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Tahsilat Admin','collections@example.invalid','x','admin',true) RETURNING id::text`)).rows[0].id;
  const [{ db }, limitsModule, collectionsModule, actionsModule, partnersModule, inputModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/partner/limits"), import("../src/modules/partner/collections"), import("../src/modules/admin/partner-actions"),
    import("../src/modules/admin/partners"), import("../src/modules/admin/partner-input")]);
  limits = limitsModule; collections = collectionsModule; actions = actionsModule; adminPartners = partnersModule; input = inputModule;
  closeDb = () => db.end();
});
beforeEach(async () => {
  signedIn = null;
  await schema.pool.query("DELETE FROM partner_invoice_payments; DELETE FROM partner_invoice_changes; DELETE FROM commerce_orders; DELETE FROM partner_settings");
});
after(async () => {
  if (originalKeys === undefined) delete process.env.PARTNER_API_KEYS; else process.env.PARTNER_API_KEYS = originalKeys;
  await closeDb?.(); await schema?.drop();
});

test("partial payments add up to a paid invoice; the ledger follows and the limit's exposure never moves", async () => {
  const ref = newRef();
  await order(1000, ref); await order(500, ref);
  const exposure = await limits.partnerExposure("bakimx");
  assert.deepEqual(await ledgerOf(ref), { partner: "bakimx", invoiceRef: ref, invoiceDate: day, count: 2, totalKurus: 1500, collectedKurus: 0, markedBy: "Tahsilat Admin" });
  const first = await pay(ref, 600, { totalKurus: 1500, collectedKurus: 0 });
  assert.equal(first.status, "recorded");
  assert.equal(first.status === "recorded" && first.balanceKurus, 900);
  assert.equal((await ledgerOf(ref))?.collectedKurus, 600);
  const second = await pay(ref, 900, { totalKurus: 1500, collectedKurus: 600 });
  assert.equal(second.status === "recorded" && second.balanceKurus, 0);
  assert.equal((await ledgerOf(ref))?.collectedKurus, 1500);
  // A paid invoice takes nothing more.
  assert.deepEqual(await pay(ref, 1, { totalKurus: 1500, collectedKurus: 1500 }), { status: "overpaid", balanceKurus: 0 });
  assert.deepEqual(await limits.partnerExposure("bakimx"), exposure);
  const [row] = (await schema.pool.query("SELECT method,note,recorded_by::text,to_char(paid_on,'YYYY-MM-DD') AS paid_on FROM partner_invoice_payments ORDER BY id LIMIT 1")).rows;
  assert.deepEqual(row, { method: "bank_transfer", note: "", recorded_by: admin, paid_on: "2026-11-16" });
});

test("over-payment, a stale dialog (double submit) and a missing invoice are refused without a write", async () => {
  const ref = newRef();
  await order(1000, ref);
  assert.deepEqual(await pay(ref, 1001, { totalKurus: 1000, collectedKurus: 0 }), { status: "overpaid", balanceKurus: 1000 });
  assert.equal((await pay(ref, 400, { totalKurus: 1000, collectedKurus: 0 })).status, "recorded");
  // The same dialog submitted again: the collected amount it showed is stale.
  assert.deepEqual(await pay(ref, 400, { totalKurus: 1000, collectedKurus: 0 }), { status: "changed" });
  assert.deepEqual(await pay(ref, 400, { totalKurus: 999, collectedKurus: 400 }), { status: "changed" });
  assert.deepEqual(await pay(ref, 400, { totalKurus: 1000, collectedKurus: 400 }, "2026-11-14"), { status: "nothing" });
  assert.deepEqual(await pay(ref, 400, { totalKurus: 1000, collectedKurus: 400 }, day, "other"), { status: "nothing" });
  assert.deepEqual((await paymentRows()).map(row => row.amount_kurus), ["400"]);
});

test("a void reopens the balance; voiding again or an unknown payment finds nothing", async () => {
  const ref = newRef();
  await order(1000, ref);
  const recorded = await pay(ref, 1000, { totalKurus: 1000, collectedKurus: 0 });
  assert.equal(recorded.status, "recorded");
  const id = recorded.status === "recorded" ? recorded.id : "";
  assert.deepEqual(await collections.voidInvoicePayment({ paymentId: id, reason: "Yanlış faturaya girildi", adminId: admin }), { status: "voided", partner: "bakimx" });
  assert.equal((await ledgerOf(ref))?.collectedKurus, 0);
  assert.deepEqual(await collections.voidInvoicePayment({ paymentId: id, reason: "Yanlış faturaya girildi", adminId: admin }), { status: "nothing" });
  assert.deepEqual(await collections.voidInvoicePayment({ paymentId: "999999999", reason: "Yanlış faturaya girildi", adminId: admin }), { status: "nothing" });
  const [payment] = await collections.recentInvoicePayments(["bakimx"]);
  assert.deepEqual([payment.voidReason, payment.voidedBy, payment.recordedBy, payment.amountKurus], ["Yanlış faturaya girildi", "Tahsilat Admin", "Tahsilat Admin", 1000]);
  assert.ok(payment.voidedAt instanceof Date);
  // The balance is open again.
  assert.equal((await pay(ref, 1000, { totalKurus: 1000, collectedKurus: 0 })).status, "recorded");
});

test("correcting an invoice carries its payments, voided ones too, to the new number and day", async () => {
  const ref = newRef(), fixed = newRef();
  await order(1000, ref);
  const voided = await pay(ref, 300, { totalKurus: 1000, collectedKurus: 0 });
  await collections.voidInvoicePayment({ paymentId: voided.status === "recorded" ? voided.id : "", reason: "Tutar yanlış girildi", adminId: admin });
  await pay(ref, 700, { totalKurus: 1000, collectedKurus: 0 });
  assert.deepEqual(await limits.changePartnerInvoice({ partner: "bakimx", invoiceRef: ref, invoiceDate: day, action: "correct", newInvoiceRef: fixed, newInvoiceDate: "2026-11-16",
    reason: "Numara yanlış yazıldı", adminId: admin, expected: { count: 1, totalKurus: 1000 } }), { status: "corrected", count: 1, totalKurus: 1000 });
  assert.deepEqual((await paymentRows()).map(row => [row.invoice_ref, row.invoice_day, row.voided]), [[fixed, "2026-11-16", true], [fixed, "2026-11-16", false]]);
  assert.equal((await ledgerOf(fixed, "2026-11-16"))?.collectedKurus, 700);
  assert.equal(await collections.orphanPaymentCount(["bakimx"]), 0);
});

test("a whole-invoice undo is refused while a payment is active and allowed once it is voided", async () => {
  const ref = newRef();
  await order(1000, ref); await order(500, ref);
  const recorded = await pay(ref, 200, { totalKurus: 1500, collectedKurus: 0 });
  assert.deepEqual(await undoInvoice(ref, 2, 1500), { status: "collected" });
  assert.equal((await ledgerOf(ref))?.count, 2);
  assert.equal((await schema.pool.query("SELECT count(*)::int AS count FROM partner_invoice_changes")).rows[0].count, 0);
  await collections.voidInvoicePayment({ paymentId: recorded.status === "recorded" ? recorded.id : "", reason: "Tahsilat yanlış girildi", adminId: admin });
  assert.deepEqual(await undoInvoice(ref, 2, 1500), { status: "undone", count: 2, totalKurus: 1500 });
  // Only the voided payment is left behind, which is no orphan.
  assert.equal(await collections.orphanPaymentCount(["bakimx"]), 0);
});

test("a single-order undo is allowed while the rest of the invoice covers what was collected, refused otherwise and on the last order", async () => {
  const ref = newRef();
  const big = await order(1000, ref), small = await order(500, ref);
  await pay(ref, 400, { totalKurus: 1500, collectedKurus: 0 });
  // Without the 1000 order 500 is left, enough for 400.
  assert.equal((await undoOrder(big, ref)).status, "undone");
  assert.deepEqual(await undoOrder(small, ref), { status: "collected" });
  assert.equal((await ledgerOf(ref))?.totalKurus, 500);

  const other = newRef();
  const large = await order(1000, other), little = await order(500, other);
  await pay(other, 800, { totalKurus: 1500, collectedKurus: 0 });
  assert.deepEqual(await undoOrder(large, other), { status: "collected" });
  assert.equal((await undoOrder(little, other)).status, "undone");
  const left = await ledgerOf(other);
  assert.deepEqual([left?.totalKurus, left?.collectedKurus], [1000, 800]);
  assert.equal(await collections.orphanPaymentCount(["bakimx"]), 0);
});

test("re-marking orders with the same number and day grows the invoice: a paid one becomes partially paid", async () => {
  const ref = newRef();
  await order(1000, ref);
  await pay(ref, 1000, { totalKurus: 1000, collectedKurus: 0 });
  await order(250, null);
  assert.equal((await limits.invoicePartnerOrders({ partner: "bakimx", deliveredUntil: "2026-11-10", invoiceRef: ref, invoiceDate: day, adminId: admin,
    expected: { count: 1, totalKurus: 250 } })).status, "invoiced");
  const invoice = await ledgerOf(ref);
  assert.deepEqual([invoice?.totalKurus, invoice?.collectedKurus], [1250, 1000]);
  assert.equal(input.invoiceCollection({ totalKurus: 1250, collectedKurus: 1000, invoiceDate: day, termDays: null, today: "2026-11-21" }).state, "partial");
});

test("a payment waits for the partner's order lock", async () => {
  const ref = newRef();
  await order(1000, ref);
  const holder = await schema.pool.connect();
  try {
    await holder.query("BEGIN");
    await limits.lockPartnerOrders(holder, "bakimx");
    let settled = false;
    const pending = pay(ref, 1000, { totalKurus: 1000, collectedKurus: 0 }).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(settled, false, "the payment ran while the partner's order lock was held");
    await holder.query("COMMIT");
    assert.equal((await pending).status, "recorded");
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
});

test("the table refuses a zero amount, an unknown method, a long note and a void without a proper reason", async () => {
  const insert = (amount: number, method: string, note = "", voided = "NULL", reason: string | null = null) => schema.pool.query(
    `INSERT INTO partner_invoice_payments(partner_code,invoice_ref,invoice_day,amount_kurus,paid_on,method,note,voided_at,void_reason)
     VALUES('bakimx','X','2026-11-15',$1,'2026-11-16',$2,$3,${voided},$4)`, [amount, method, note, reason]);
  await assert.rejects(insert(0, "check"), { code: "23514" });
  await assert.rejects(insert(100, "cash"), { code: "23514" });
  await assert.rejects(insert(100, "check", "x".repeat(501)), { code: "23514" });
  await assert.rejects(insert(100, "check", "", "now()"), { code: "23514" });
  await assert.rejects(insert(100, "check", "", "NULL", "Gerekçe yazıldı"), { code: "23514" });
  await assert.rejects(insert(100, "check", "", "now()", "  abc  "), { code: "23514" });
  await insert(100, "offset", "İade faturası İ-1", "now()", "Gerekçe yazıldı");
  await assert.rejects(schema.pool.query("INSERT INTO partner_settings(partner_code,payment_term_days) VALUES('bakimx',-1)"), { code: "23514" });
});

test("invoiceCollection: no term is never overdue, due today is not overdue yet, partial can be overdue, paid is paid", () => {
  const base = { totalKurus: 1000, invoiceDate: "2026-10-31", today: "2026-11-30" };
  assert.deepEqual(input.invoiceCollection({ ...base, collectedKurus: 0, termDays: null }), { state: "open", dueDate: null, balanceKurus: 1000, overdueDays: 0 });
  assert.deepEqual(input.invoiceCollection({ ...base, collectedKurus: 0, termDays: 30 }), { state: "open", dueDate: "2026-11-30", balanceKurus: 1000, overdueDays: 0 });
  assert.deepEqual(input.invoiceCollection({ ...base, collectedKurus: 300, termDays: 29 }), { state: "overdue", dueDate: "2026-11-29", balanceKurus: 700, overdueDays: 1 });
  assert.deepEqual(input.invoiceCollection({ ...base, collectedKurus: 300, termDays: 30 }), { state: "partial", dueDate: "2026-11-30", balanceKurus: 700, overdueDays: 0 });
  assert.deepEqual(input.invoiceCollection({ ...base, collectedKurus: 1000, termDays: 0 }), { state: "paid", dueDate: "2026-10-31", balanceKurus: 0, overdueDays: 0 });
  // Day arithmetic crosses the October clock change and a leap day in UTC.
  assert.equal(input.invoiceCollection({ ...base, invoiceDate: "2028-02-28", collectedKurus: 0, termDays: 1 }).dueDate, "2028-02-29");
  assert.equal(input.invoiceCollection({ ...base, invoiceDate: "2026-12-01", collectedKurus: 0, termDays: 365, today: "2028-01-05" }).overdueDays, 35);
});

test("payment, void and term inputs: TL amounts, past days, known methods, reasons and whole-day terms", () => {
  const now = new Date("2026-11-21T09:00:00Z");
  const valid = { partner: "bakimx", invoiceRef: "F-1", invoiceDate: "2026-11-15", amount: "1.234,5", paidOn: "2026-11-21", method: "offset", note: " not ", expectedTotal: "1000", expectedCollected: "0" };
  assert.equal(input.partnerPaymentInput(now).safeParse(valid).success, false, "1.234,5 is not a TL amount the parser accepts");
  const parsed = input.partnerPaymentInput(now).parse({ ...valid, amount: "1234,5" });
  assert.deepEqual([parsed.amount, parsed.method, parsed.note, parsed.expectedTotal, parsed.expectedCollected], [123450, "offset", "not", 1000, 0]);
  for (const bad of [{ amount: "0" }, { amount: "" }, { amount: "-5" }, { paidOn: "2026-11-22" }, { paidOn: "2026-02-30" }, { method: "cash" }, { note: "x".repeat(501) },
    { expectedCollected: "-1" }, { expectedTotal: "0" }, { invoiceDate: "15.11.2026" }]) {
    assert.equal(input.partnerPaymentInput(now).safeParse({ ...valid, amount: "10", ...bad }).success, false, JSON.stringify(bad));
  }
  assert.deepEqual(input.partnerPaymentVoidInput.parse({ payment: "42", reason: " Yanlış girdi " }), { payment: "42", reason: "Yanlış girdi" });
  for (const payment of ["0", "-1", "1.5", "abc", ""]) assert.equal(input.partnerPaymentVoidInput.safeParse({ payment, reason: "Yanlış girdi" }).success, false, payment);
  assert.equal(input.partnerPaymentVoidInput.safeParse({ payment: "42", reason: "kısa" }).success, false);
  assert.deepEqual(input.partnerTermInput.parse({ partner: "bakimx", term: "" }), { partner: "bakimx", term: null });
  assert.deepEqual(input.partnerTermInput.parse({ partner: "bakimx", term: " 30 " }), { partner: "bakimx", term: 30 });
  assert.equal(input.partnerTermInput.parse({ partner: "bakimx", term: "0" }).term, 0);
  for (const term of ["366", "-1", "7.5", "abc"]) assert.equal(input.partnerTermInput.safeParse({ partner: "bakimx", term }).success, false, term);
  assert.equal(input.paymentMethodLabel("offset"), "Mahsup (iade faturası)");
});

test("the /yonetim actions: admin first, the term redirect, payment and void results, and the collected refusal of an undo", async () => {
  const ref = newRef();
  const only = await order(100_000, ref, "2026-10-01");
  const paymentForm = (amount: string, expectedCollected: string) => form({ partner: "bakimx", invoiceRef: ref, invoiceDate: "2026-10-01", amount, paidOn: "2026-10-20",
    method: "check", note: "Çek no 123", expectedTotal: "100000", expectedCollected });
  await assert.rejects(actions.recordPartnerPayment({ status: "idle" }, paymentForm("400", "0")), /NEXT_REDIRECT \/giris/);
  await assert.rejects(actions.savePartnerPaymentTerm(form({ partner: "bakimx", term: "30" })), /NEXT_REDIRECT \/giris/);
  assert.deepEqual(await paymentRows(), []);
  signedIn = admin;
  await assert.rejects(actions.savePartnerPaymentTerm(form({ partner: "bakimx", term: "400" })), /NEXT_REDIRECT \/yonetim\/partnerler\?error=term&partner=bakimx$/);
  await assert.rejects(actions.savePartnerPaymentTerm(form({ partner: "stranger", term: "30" })), /NEXT_REDIRECT \/yonetim\/partnerler\?error=term$/);
  await assert.rejects(actions.savePartnerPaymentTerm(form({ partner: "bakimx", term: "30" })), /NEXT_REDIRECT \/yonetim\/partnerler\?term=bakimx$/);
  assert.deepEqual((await collections.paymentTerms(["bakimx"])).get("bakimx"), 30);

  const over = await actions.recordPartnerPayment({ status: "idle" }, paymentForm("1000,01", "0"));
  assert.equal(over.status, "error");
  assert.match(over.errors?.amount?.[0] ?? "", /kalanını/);
  assert.deepEqual(await actions.recordPartnerPayment({ status: "idle" }, paymentForm("400", "0")), { status: "success", next: "/yonetim/partnerler?collected=bakimx" });
  const stale = await actions.recordPartnerPayment({ status: "idle" }, paymentForm("400", "0"));
  assert.match(stale.message ?? "", /değişti/);

  // The page's view: due 2026-10-31 with a 30-day term, overdue since, partially paid.
  const view = await adminPartners.adminPartnerInvoices();
  const invoice = view.invoices.find(row => row.invoiceRef === ref);
  assert.deepEqual([invoice?.state, invoice?.dueDate, invoice?.balanceKurus], ["overdue", "2026-10-31", 60_000]);
  assert.deepEqual(view.collections.find(row => row.code === "bakimx"), { code: "bakimx", termDays: 30, uncollectedKurus: 60_000, overdueKurus: 60_000, overdueCount: 1 });
  assert.equal(view.payments.length, 1);
  assert.equal(view.orphanCount, 0);

  const undo = await actions.changePartnerInvoiceMark({ status: "idle" }, form({ partner: "bakimx", invoiceRef: ref, invoiceDate: "2026-10-01", action: "undo",
    reason: "Yanlış işaretlendi", expectedCount: "1", expectedTotal: "100000" }));
  assert.deepEqual(undo, { status: "error", message: "Bu faturaya tahsilat girilmiş; önce tahsilatı iptal edin." });
  const single = await actions.undoPartnerOrderInvoiceMark({ status: "idle" }, form({ order: only, invoiceRef: ref, invoiceDate: "2026-10-01", reason: "Yanlış işaretlendi" }));
  assert.deepEqual(single, { status: "error", message: "Bu faturaya tahsilat girilmiş; önce tahsilatı iptal edin." });

  const short = await actions.voidPartnerPayment({ status: "idle" }, form({ payment: view.payments[0].id, reason: "abc" }));
  assert.ok(short.errors?.reason?.length);
  assert.deepEqual(await actions.voidPartnerPayment({ status: "idle" }, form({ payment: view.payments[0].id, reason: "Çek karşılıksız çıktı" })),
    { status: "success", next: "/yonetim/partnerler?voided=bakimx" });
  assert.match((await actions.voidPartnerPayment({ status: "idle" }, form({ payment: view.payments[0].id, reason: "Çek karşılıksız çıktı" }))).message ?? "", /zaten iptal/);
});
