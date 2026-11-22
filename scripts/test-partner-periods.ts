import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";

// Partner period close and monthly statements (#1200) in an isolated copy of the schema: closing (idempotent, future
// refused) and reopening with a reason, the table's CHECKs, the guards on invoices (Istanbul invoice day) and payments
// (paid_on only) while a month is closed, the partner lock, the statement's balances, the CSV layout, the inputs and
// the /yonetim actions.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let limits: typeof import("../src/modules/partner/limits");
let collections: typeof import("../src/modules/partner/collections");
let periods: typeof import("../src/modules/partner/periods");
let statementCsv: typeof import("../src/modules/partner/statement-csv");
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
const newRef = () => `F-${randomUUID().slice(0, 8)}`;
const closedMonth = "2026-10";
const closedDay = "2026-10-15";
const openDay = "2026-09-15";

/** A delivered partner order, invoiced under `ref` on `invoiceDay` (Istanbul) unless ref is null. */
async function order(totalKurus: number, ref: string | null, invoiceDay = closedDay, partner = "bakimx") {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,
    total_kurus,subtotal_kurus,discount_percent,status,payment_status,delivered_at,partner_invoiced_at,partner_invoice_ref,partner_invoiced_by)
    VALUES('partner',$1,gen_random_uuid(),'Usta Oto','p@example.invalid','5551234567','Adres',$2,$2,0,'delivered','on_account','2026-09-10T10:00:00Z',
     CASE WHEN $3::text IS NULL THEN NULL ELSE ($4::date)::timestamp AT TIME ZONE 'Europe/Istanbul' END,$3,CASE WHEN $3::text IS NULL THEN NULL ELSE $5::uuid END)
    RETURNING id::text`, [partner, totalKurus, ref, invoiceDay, admin]);
  return rows[0].id;
}
/** A payment row written directly (no guard), so tests can place it in a month before closing it. */
async function payment(ref: string, invoiceDay: string, amountKurus: number, paidOn: string, partner = "bakimx", voided = false, note = "") {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO partner_invoice_payments(partner_code,invoice_ref,invoice_day,amount_kurus,paid_on,method,note,
    recorded_by,voided_at,void_reason) VALUES($1,$2,$3,$4,$5,'bank_transfer',$6,$7,${voided ? "now(),'Yanlış girildi'" : "NULL,NULL"}) RETURNING id::text`,
  [partner, ref, invoiceDay, amountKurus, paidOn, note, admin]);
  return rows[0].id;
}
const pay = (invoiceRef: string, invoiceDate: string, amountKurus: number, paidOn: string, expected: { totalKurus: number; collectedKurus: number }, partner = "bakimx") =>
  collections.recordInvoicePayment({ partner, invoiceRef, invoiceDate, amountKurus, paidOn, method: "bank_transfer", note: "", adminId: admin, expected });
const close = (period = closedMonth, partner = "bakimx", note = "") => periods.closePeriod({ partner, period, note, adminId: admin });
const reopen = (period = closedMonth, partner = "bakimx") => periods.reopenPeriod({ partner, period, reason: "Fatura düzeltmesi gerekiyor", adminId: admin });
const count = async (table: string) => (await schema.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
/** Everything the guards protect, as one comparable snapshot. */
const snapshot = async () => (await schema.pool.query(`SELECT
  (SELECT jsonb_agg(jsonb_build_array(id,partner_invoice_ref,partner_invoiced_at) ORDER BY id) FROM commerce_orders) AS orders,
  (SELECT jsonb_agg(jsonb_build_array(id,invoice_ref,invoice_day,voided_at) ORDER BY id) FROM partner_invoice_payments) AS payments,
  (SELECT count(*) FROM partner_invoice_changes) AS changes`)).rows[0];
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date()).slice(0, 7);
const nextMonth = () => { const [year, month] = currentMonth().split("-").map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7); };

before(async () => {
  schema = await isolatedSchema("partner_periods_test");
  process.env.PARTNER_API_KEYS = `bakimx:${"k".repeat(24)}`;
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Dönem Admin','periods@example.invalid','x','admin',true) RETURNING id::text`)).rows[0].id;
  const [{ db }, limitsModule, collectionsModule, periodsModule, csvModule, actionsModule, partnersModule, inputModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/partner/limits"), import("../src/modules/partner/collections"), import("../src/modules/partner/periods"),
    import("../src/modules/partner/statement-csv"), import("../src/modules/admin/partner-actions"), import("../src/modules/admin/partners"),
    import("../src/modules/admin/partner-input")]);
  limits = limitsModule; collections = collectionsModule; periods = periodsModule; statementCsv = csvModule; actions = actionsModule;
  adminPartners = partnersModule; input = inputModule;
  closeDb = () => db.end();
});
beforeEach(async () => {
  signedIn = null;
  await schema.pool.query(`DELETE FROM partner_period_events; DELETE FROM partner_period_closes; DELETE FROM partner_invoice_payments;
    DELETE FROM partner_invoice_changes; DELETE FROM commerce_orders; DELETE FROM partner_settings`);
});
after(async () => {
  if (originalKeys === undefined) delete process.env.PARTNER_API_KEYS; else process.env.PARTNER_API_KEYS = originalKeys;
  await closeDb?.(); await schema?.drop();
});

test("closing is idempotent (one row, one event), a future month is refused and the current month can be closed", async () => {
  assert.deepEqual(await close(closedMonth, "bakimx", "Ekim mutabakatı"), { status: "closed" });
  assert.deepEqual(await close(), { status: "already" });
  assert.equal(await count("partner_period_closes"), 1);
  const events = await periods.periodEvents(["bakimx"]);
  assert.deepEqual(events.map(event => [event.partner, event.period, event.action, event.reason, event.actor]), [["bakimx", closedMonth, "close", "Ekim mutabakatı", "Dönem Admin"]]);
  assert.deepEqual(await close(nextMonth()), { status: "future" });
  assert.deepEqual(await close(currentMonth()), { status: "closed" });
  const closed = await periods.closedPeriods(["bakimx"]);
  assert.deepEqual(closed.map(row => [row.period, row.closedBy]), [[currentMonth(), "Dönem Admin"], [closedMonth, "Dönem Admin"]]);
  assert.equal(await count("partner_period_events"), 2);
});

test("reopening deletes the close with a reason event; an open month finds nothing and leaves no event", async () => {
  await close();
  assert.deepEqual(await reopen(), { status: "reopened" });
  assert.equal(await count("partner_period_closes"), 0);
  const [latest] = await periods.periodEvents(["bakimx"]);
  assert.deepEqual([latest.action, latest.reason, latest.actor, latest.period], ["reopen", "Fatura düzeltmesi gerekiyor", "Dönem Admin", closedMonth]);
  assert.deepEqual(await reopen(), { status: "nothing" });
  assert.equal(await count("partner_period_events"), 2);
});

test("the tables refuse a short reopen reason, a long reason and a period that is not a month's first day", async () => {
  const event = (period: string, action: string, reason: string) => schema.pool.query(
    "INSERT INTO partner_period_events(partner_code,period,action,reason) VALUES('bakimx',$1,$2,$3)", [period, action, reason]);
  await assert.rejects(event("2026-10-01", "reopen", "  abc  "), { code: "23514" });
  await assert.rejects(event("2026-10-01", "close", "x".repeat(501)), { code: "23514" });
  await assert.rejects(event("2026-10-02", "close", ""), { code: "23514" });
  await assert.rejects(event("2026-10-01", "delete", ""), { code: "23514" });
  await event("2026-10-01", "close", "");
  await assert.rejects(schema.pool.query("INSERT INTO partner_period_closes(partner_code,period) VALUES('bakimx','2026-10-15')"), { code: "23514" });
});

test("while a month is closed every invoice and payment change in it is refused without a write; reopened, they all succeed", async () => {
  const ref = newRef(), single = newRef(), old = newRef();
  await order(1000, ref);
  const first = await order(400, single), second = await order(600, single);
  await order(800, old, openDay);
  const advance = await payment(old, openDay, 300, "2026-10-20");
  const earlier = await payment(old, openDay, 100, "2026-09-20");
  await order(250, null);
  await close();
  const before = await snapshot();

  assert.deepEqual(await limits.invoicePartnerOrders({ partner: "bakimx", deliveredUntil: "2026-09-10", invoiceRef: newRef(), invoiceDate: "2026-10-31", adminId: admin,
    expected: { count: 1, totalKurus: 250 } }), { status: "closed", period: closedMonth });
  const change = { partner: "bakimx", invoiceRef: ref, invoiceDate: closedDay, reason: "Yanlış işaretlendi", adminId: admin, expected: { count: 1, totalKurus: 1000 } };
  assert.deepEqual(await limits.changePartnerInvoice({ ...change, action: "undo" }), { status: "closed", period: closedMonth, side: "current" });
  assert.deepEqual(await limits.changePartnerInvoice({ ...change, action: "correct", newInvoiceRef: newRef(), newInvoiceDate: "2026-11-02" }),
    { status: "closed", period: closedMonth, side: "current" });
  // Correcting an open month's invoice into the closed month.
  assert.deepEqual(await limits.changePartnerInvoice({ partner: "bakimx", invoiceRef: old, invoiceDate: openDay, reason: "Tarih yanlış yazıldı", adminId: admin,
    expected: { count: 1, totalKurus: 800 }, action: "correct", newInvoiceRef: old, newInvoiceDate: "2026-10-01" }), { status: "closed", period: closedMonth, side: "new" });
  assert.deepEqual(await limits.undoPartnerOrderInvoice({ orderId: first, reason: "Bu sipariş faturaya girmedi", adminId: admin, expected: { invoiceRef: single, invoiceDate: closedDay } }),
    { status: "closed", period: closedMonth });
  // Payments follow paid_on only: one paid in October is refused whatever its invoice's month.
  assert.deepEqual(await pay(old, openDay, 50, "2026-10-31", { totalKurus: 800, collectedKurus: 400 }), { status: "closed", period: closedMonth });
  assert.deepEqual(await collections.voidInvoicePayment({ paymentId: advance, reason: "Yanlış girildi", adminId: admin }), { status: "closed", period: closedMonth, partner: "bakimx" });
  assert.deepEqual(await snapshot(), before);

  // A November payment against the closed month's invoice is recorded; a September payment against an open invoice is voided.
  assert.equal((await pay(ref, closedDay, 500, "2026-11-01", { totalKurus: 1000, collectedKurus: 0 })).status, "recorded");
  assert.deepEqual(await collections.voidInvoicePayment({ paymentId: earlier, reason: "Yanlış girildi", adminId: admin }), { status: "voided", partner: "bakimx" });

  assert.deepEqual(await reopen(), { status: "reopened" });
  assert.deepEqual(await collections.voidInvoicePayment({ paymentId: advance, reason: "Yanlış girildi", adminId: admin }), { status: "voided", partner: "bakimx" });
  assert.equal((await pay(old, openDay, 50, "2026-10-31", { totalKurus: 800, collectedKurus: 0 })).status, "recorded");
  assert.equal((await limits.undoPartnerOrderInvoice({ orderId: second, reason: "Bu sipariş faturaya girmedi", adminId: admin,
    expected: { invoiceRef: single, invoiceDate: closedDay } })).status, "undone");
  assert.equal((await limits.invoicePartnerOrders({ partner: "bakimx", deliveredUntil: "2026-09-10", invoiceRef: newRef(), invoiceDate: "2026-10-31", adminId: admin,
    expected: { count: 2, totalKurus: 850 } })).status, "invoiced");
  assert.equal((await limits.changePartnerInvoice({ partner: "bakimx", invoiceRef: old, invoiceDate: openDay, reason: "Tarih yanlış yazıldı", adminId: admin,
    expected: { count: 1, totalKurus: 800 }, action: "correct", newInvoiceRef: old, newInvoiceDate: "2026-10-01" })).status, "corrected");
});

test("another partner's same month stays open", async () => {
  const ref = newRef();
  await order(1000, ref, closedDay, "other");
  await close(closedMonth, "bakimx");
  assert.equal((await pay(ref, closedDay, 100, "2026-10-20", { totalKurus: 1000, collectedKurus: 0 }, "other")).status, "recorded");
  assert.equal((await limits.changePartnerInvoice({ partner: "other", invoiceRef: ref, invoiceDate: closedDay, action: "correct", newInvoiceRef: newRef(),
    newInvoiceDate: "2026-10-16", reason: "Numara yanlış yazıldı", adminId: admin, expected: { count: 1, totalKurus: 1000 } })).status, "corrected");
});

test("closing a period waits for the partner's order lock", async () => {
  const holder = await schema.pool.connect();
  try {
    await holder.query("BEGIN");
    await limits.lockPartnerOrders(holder, "bakimx");
    let settled = false;
    const pending = close().finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(settled, false, "the close ran while the partner's order lock was held");
    await holder.query("COMMIT");
    assert.deepEqual(await pending, { status: "closed" });
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
});

test("the statement: opening and closing balances as of the period's end, voided payments listed but never counted, the Istanbul month boundary", async () => {
  const sept = newRef(), oct = newRef(), late = newRef(), nov = newRef();
  await order(10_000, sept, "2026-09-30");
  await order(4_000, oct, "2026-10-01"); await order(1_000, oct, "2026-10-01");
  // 2026-10-31 22:30 UTC is 2026-11-01 01:30 in Istanbul: a November invoice.
  await schema.pool.query(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,total_kurus,subtotal_kurus,discount_percent,
    status,payment_status,delivered_at,partner_invoiced_at,partner_invoice_ref) VALUES('partner','bakimx',gen_random_uuid(),'Usta Oto','p@example.invalid','5551234567',
    'Adres',7000,7000,0,'delivered','on_account','2026-10-30T10:00:00Z','2026-10-31T22:30:00Z',$1)`, [nov]);
  await order(2_000, late, "2026-10-31");
  await payment(sept, "2026-09-30", 3_000, "2026-09-30");
  await payment(sept, "2026-09-30", 2_000, "2026-10-05");
  await payment(oct, "2026-10-01", 1_500, "2026-10-10");
  await payment(oct, "2026-10-01", 999, "2026-10-11", "bakimx", true);
  // Paid after the period's end: not in October's statement, not reducing the October invoice's collected amount.
  await payment(oct, "2026-10-01", 500, "2026-11-02");
  await payment(nov, "2026-11-01", 700, "2026-10-31");
  await close();

  const statement = await periods.partnerStatement("bakimx", closedMonth, "2026-11-22");
  assert.equal(statement.asOf, "2026-10-31");
  assert.deepEqual(statement.invoices.map(invoice => [invoice.invoiceRef, invoice.invoiceDate, invoice.count, invoice.totalKurus, invoice.collectedKurus]),
    [[oct, "2026-10-01", 2, 5_000, 1_500], [late, "2026-10-31", 1, 2_000, 0]]);
  assert.deepEqual(statement.payments.map(row => [row.invoiceRef, row.paidOn, row.amountKurus, Boolean(row.voidedAt)]),
    [[sept, "2026-10-05", 2_000, false], [oct, "2026-10-10", 1_500, false], [oct, "2026-10-11", 999, true], [nov, "2026-10-31", 700, false]]);
  assert.equal(statement.openingKurus, 10_000 - 3_000);
  const invoiced = statement.invoices.reduce((sum, invoice) => sum + invoice.totalKurus, 0);
  const paid = statement.payments.filter(row => !row.voidedAt).reduce((sum, row) => sum + row.amountKurus, 0);
  assert.equal(statement.closingKurus, statement.openingKurus + invoiced - paid);
  assert.equal(statement.closingKurus, 7_000 + 7_000 - 4_200);
  assert.deepEqual([statement.close?.by, statement.termDays], ["Dönem Admin", null]);
  // A running month reads collections as of today; November's opening is October's closing.
  const running = await periods.partnerStatement("bakimx", "2026-11", "2026-11-01");
  assert.equal(running.asOf, "2026-11-01");
  assert.equal(running.openingKurus, statement.closingKurus);
  assert.deepEqual(running.invoices.map(invoice => [invoice.invoiceRef, invoice.collectedKurus]), [[nov, 700]]);
  assert.equal(running.close, null);
  // An advance makes the balance negative.
  await payment(late, "2026-10-31", 2_000, "2026-08-01");
  assert.equal((await periods.partnerStatement("bakimx", "2026-08", "2026-11-22")).closingKurus, -2_000);
});

test("the statement CSV: BOM, ';' and CRLF, headers, comma decimals, quoted and formula-guarded notes, voided rows", () => {
  const csv = statementCsv.buildPartnerStatementCsv({
    partner: "bakimx", period: closedMonth, periodLabel: "Ekim 2026", asOf: "2026-10-31", issuedOn: "2026-11-22", termDays: 30,
    close: { at: new Date("2026-11-01T09:00:00Z"), by: "Dönem Admin" }, openingKurus: 700_000, closingKurus: 123_450,
    invoices: [{ invoiceRef: "00123", invoiceDate: "2026-10-01", count: 2, totalKurus: 123_450, collectedKurus: 23_450, state: "partial", dueDate: "2026-10-31", balanceKurus: 100_000 }],
    payments: [
      { id: "1", invoiceRef: "00123", invoiceDate: "2026-10-01", amountKurus: 23_450, paidOn: "2026-10-10", method: "check", note: "Çek; no 5", voidedAt: null, voidReason: null },
      { id: "2", invoiceRef: "00123", invoiceDate: "2026-10-01", amountKurus: 100, paidOn: "2026-10-11", method: "other", note: "=HYPERLINK(1)", voidedAt: new Date(), voidReason: "Yanlış girildi" },
    ],
  });
  assert.ok(csv.startsWith("﻿Partner;bakimx\r\n"));
  assert.ok(csv.endsWith("Dönem sonu açık bakiye (TL);1234,50\r\n"));
  assert.ok(!/[^\r]\n/.test(csv), "every line ends with CRLF");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[1], "Dönem;Ekim 2026");
  assert.match(lines[2], /^Dönem durumu;Kapalı · .*2026.* · Dönem Admin$/);
  assert.equal(lines[3], "Düzenlenme tarihi;22.11.2026");
  assert.equal(lines[4], "Devreden açık bakiye (TL);7000,00");
  assert.ok(lines.includes("Fatura No;Fatura Tarihi;Sipariş Adedi;Tutar (TL);Tahsil Edilen (TL);Kalan (TL);Vade Tarihi;Durum"));
  assert.ok(lines.includes("=\"00123\";01.10.2026;2;1234,50;234,50;1000,00;31.10.2026;Kısmi ödendi"));
  assert.ok(lines.includes("Toplam;;2;1234,50;234,50;1000,00;;"));
  assert.ok(lines.includes("Ödeme Tarihi;Fatura No;Fatura Tarihi;Yöntem;Tutar (TL);Durum;İptal Gerekçesi;Not"));
  assert.ok(lines.includes("10.10.2026;=\"00123\";01.10.2026;Çek;234,50;Geçerli;;\"Çek; no 5\""));
  assert.ok(lines.includes("11.10.2026;=\"00123\";01.10.2026;Diğer;1,00;İptal edildi;Yanlış girildi;'=HYPERLINK(1)"));
  assert.ok(lines.includes("Toplam (geçerli);;;;234,50;;;"));
});

test("inputs: the month shape, no future month, the reopen reason and the period helpers", () => {
  const now = new Date("2026-10-31T22:30:00Z"); // 2026-11-01 in Istanbul
  const closeInput = input.partnerPeriodCloseInput(now);
  assert.deepEqual(closeInput.parse({ partner: "bakimx", period: "2026-11", note: " Kasım " }), { partner: "bakimx", period: "2026-11", note: "Kasım" });
  for (const period of ["2026-13", "2026-00", "2026-1", "2026-12", "11.2026", ""]) assert.equal(closeInput.safeParse({ partner: "bakimx", period, note: "" }).success, false, period);
  assert.equal(closeInput.safeParse({ partner: "bakimx", period: "2026-10", note: "x".repeat(501) }).success, false);
  assert.equal(input.partnerPeriodReopenInput.safeParse({ partner: "bakimx", period: "2026-10", reason: "kısa" }).success, false);
  assert.equal(input.partnerPeriodReopenInput.safeParse({ partner: "bakimx", period: "2026-10", reason: "x".repeat(501) }).success, false);
  assert.equal(input.partnerPeriodReopenInput.safeParse({ partner: "bakimx", period: "2026-10", reason: "Fatura düzeltmesi" }).success, true);
  assert.equal(input.partnerStatementInput(now).safeParse({ partner: "bakimx", donem: "2026-12" }).success, false);
  assert.equal(input.periodLabel("2026-10"), "Ekim 2026");
  assert.equal(input.periodLabel("2027-01"), "Ocak 2027");
  assert.deepEqual(input.recentPeriods(now, 3), ["2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(input.recentPeriods(new Date("2027-01-15T12:00:00Z"), 2), ["2027-01", "2026-12"]);
  assert.equal(input.periodEnd("2028-02"), "2028-02-29");
  assert.equal(input.periodEnd("2026-12"), "2026-12-31");
});

test("the /yonetim actions: admin first, unknown partner refused, result URLs and the closed message on the right field", async () => {
  await assert.rejects(actions.closePartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, note: "" })), /NEXT_REDIRECT \/giris/);
  await assert.rejects(actions.reopenPartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, reason: "Fatura düzeltmesi" })), /NEXT_REDIRECT \/giris/);
  assert.equal(await count("partner_period_events"), 0);
  signedIn = admin;
  assert.deepEqual(await actions.closePartnerPeriod({ status: "idle" }, form({ partner: "stranger", period: closedMonth, note: "" })),
    { status: "error", message: "Partner bulunamadı. Sayfayı yenileyin." });
  assert.ok((await actions.closePartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: nextMonth(), note: "" }))).errors?.period?.length);
  assert.equal(await count("partner_period_closes"), 0);
  assert.deepEqual(await actions.closePartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, note: "" })),
    { status: "success", next: `/yonetim/partnerler?period_closed=bakimx&donem=${closedMonth}` });
  assert.deepEqual(await actions.closePartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, note: "" })),
    { status: "success", next: `/yonetim/partnerler?period_closed=bakimx&donem=${closedMonth}` });

  const message = "Ekim 2026 dönemi bu partner için kapatılmış. İşlem için önce dönemi gerekçeyle yeniden açın.";
  await order(250, null);
  assert.deepEqual(await actions.markPartnerInvoiced({ status: "idle" }, form({ partner: "bakimx", deliveredUntil: "2026-09-10", invoiceRef: newRef(), invoiceDate: "2026-10-20",
    expectedCount: "1", expectedTotal: "250" })), { status: "error", errors: { invoiceDate: [message] } });
  const ref = newRef(), old = newRef();
  await order(1000, ref);
  await order(800, old, openDay);
  assert.deepEqual(await actions.recordPartnerPayment({ status: "idle" }, form({ partner: "bakimx", invoiceRef: old, invoiceDate: openDay, amount: "1", paidOn: "2026-10-02",
    method: "check", note: "", expectedTotal: "800", expectedCollected: "0" })), { status: "error", errors: { paidOn: [message] } });
  const changeForm = { partner: "bakimx", action: "correct", reason: "Tarih yanlış yazıldı", newInvoiceRef: newRef(), expectedCount: "1" };
  assert.deepEqual(await actions.changePartnerInvoiceMark({ status: "idle" }, form({ ...changeForm, invoiceRef: old, invoiceDate: openDay, newInvoiceDate: "2026-10-03",
    expectedTotal: "800" })), { status: "error", errors: { newInvoiceDate: [message] } });
  assert.deepEqual(await actions.changePartnerInvoiceMark({ status: "idle" }, form({ ...changeForm, invoiceRef: ref, invoiceDate: closedDay, newInvoiceDate: "2026-09-03",
    expectedTotal: "1000" })), { status: "error", message });

  const view = await adminPartners.adminPartnerInvoices();
  assert.deepEqual(view.invoices.map(invoice => [invoice.invoiceRef, invoice.periodClosed]).sort(), [[old, false], [ref, true]].sort());
  const periodsView = await adminPartners.adminPartnerPeriods();
  assert.ok(periodsView.rows.some(row => row.partner === "bakimx" && row.period === closedMonth && row.closed?.by === "Dönem Admin"));
  assert.equal(periodsView.periods.length, 24);
  assert.equal(periodsView.events.length, 1);
  assert.equal(await adminPartners.adminPartnerStatement({ partner: "stranger", donem: closedMonth }), null);
  assert.equal(await adminPartners.adminPartnerStatement({ partner: "bakimx", donem: "2026-13" }), null);
  assert.equal((await adminPartners.adminPartnerStatement({ partner: "bakimx", donem: closedMonth }))?.periodLabel, "Ekim 2026");

  assert.ok((await actions.reopenPartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, reason: "abc" }))).errors?.reason?.length);
  assert.deepEqual(await actions.reopenPartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, reason: "Fatura düzeltmesi" })),
    { status: "success", next: `/yonetim/partnerler?period_reopened=bakimx&donem=${closedMonth}` });
  assert.deepEqual(await actions.reopenPartnerPeriod({ status: "idle" }, form({ partner: "bakimx", period: closedMonth, reason: "Fatura düzeltmesi" })),
    { status: "error", message: "Bu dönem zaten açık. Sayfayı yenileyin." });
});
