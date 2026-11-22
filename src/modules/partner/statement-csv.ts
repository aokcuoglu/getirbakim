import { csvFile, csvRef, csvSafe } from "@/lib/csv";
import { formatDateTime, formatDay } from "@/modules/admin/format";
import type { CollectionState } from "@/modules/admin/partner-input";
import { paymentMethodLabels } from "./payment-methods";
import type { PartnerStatement, StatementInvoice } from "./periods";

/** A statement invoice with its collection status as of the statement's day (invoiceCollection). */
export type StatementCsvInvoice = StatementInvoice & { state: CollectionState; dueDate: string | null; balanceKurus: number };
export type StatementCsvInput = Omit<PartnerStatement, "invoices"> & { invoices: StatementCsvInvoice[]; periodLabel: string; issuedOn: string };

const stateLabels: Record<CollectionState, string> = { paid: "Ödendi", partial: "Kısmi ödendi", open: "Açık", overdue: "Vadesi geçti" };

/** Kuruş → "1234,50" (no grouping, "," decimals, as Turkish Excel reads a number). */
const amount = (kurus: number) => (kurus / 100).toFixed(2).replace(".", ",");
const row = (cells: string[]) => cells.join(";");

/**
 * A partner's monthly statement (#1200) as Excel (Turkish) opens it: UTF-8 BOM, ";" delimiter, CRLF, "," decimals,
 * DD.MM.YYYY days. Meta rows, the month's invoices with a total row, its payments (voided ones listed, not totalled) and
 * the closing balance. Invoice numbers are written so Excel keeps them as text; free text is formula-guarded.
 */
export function buildPartnerStatementCsv(statement: StatementCsvInput) {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const active = statement.payments.filter(payment => !payment.voidedAt);
  const status = statement.close
    ? `Kapalı · ${formatDateTime(statement.close.at, { year: true })} · ${statement.close.by ?? "—"}`
    : "Açık";
  return csvFile([
    row(["Partner", csvSafe(statement.partner)]),
    row(["Dönem", csvSafe(statement.periodLabel)]),
    row(["Dönem durumu", csvSafe(status)]),
    row(["Düzenlenme tarihi", formatDay(statement.issuedOn)]),
    row(["Devreden açık bakiye (TL)", amount(statement.openingKurus)]),
    "",
    "Faturalar",
    row(["Fatura No", "Fatura Tarihi", "Sipariş Adedi", "Tutar (TL)", "Tahsil Edilen (TL)", "Kalan (TL)", "Vade Tarihi", "Durum"]),
    ...statement.invoices.map(invoice => row([csvRef(invoice.invoiceRef), formatDay(invoice.invoiceDate), String(invoice.count), amount(invoice.totalKurus),
      amount(invoice.collectedKurus), amount(invoice.balanceKurus), invoice.dueDate ? formatDay(invoice.dueDate) : "", stateLabels[invoice.state]])),
    row(["Toplam", "", String(sum(statement.invoices.map(invoice => invoice.count))), amount(sum(statement.invoices.map(invoice => invoice.totalKurus))),
      amount(sum(statement.invoices.map(invoice => invoice.collectedKurus))), amount(sum(statement.invoices.map(invoice => invoice.balanceKurus))), "", ""]),
    "",
    "Tahsilatlar",
    row(["Ödeme Tarihi", "Fatura No", "Fatura Tarihi", "Yöntem", "Tutar (TL)", "Durum", "İptal Gerekçesi", "Not"]),
    ...statement.payments.map(payment => row([formatDay(payment.paidOn), csvRef(payment.invoiceRef), formatDay(payment.invoiceDate), paymentMethodLabels[payment.method],
      amount(payment.amountKurus), payment.voidedAt ? "İptal edildi" : "Geçerli", csvSafe(payment.voidReason ?? ""), csvSafe(payment.note)])),
    row(["Toplam (geçerli)", "", "", "", amount(sum(active.map(payment => payment.amountKurus))), "", "", ""]),
    "",
    row(["Dönem sonu açık bakiye (TL)", amount(statement.closingKurus)]),
  ]);
}
