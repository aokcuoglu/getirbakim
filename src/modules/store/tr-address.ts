import provinceData from "./tr-provinces.json";

/**
 * Turkey's 81 provinces with their districts (#881), from turkey-neighbourhoods 4.0.3 (MIT, PTT postal code list);
 * see docs/commerce.md. `plate` is the licence plate code, which is also the first two digits of a postal code.
 */
export type Province = { plate: number; name: string; districts: string[] };
export const provinces: readonly Province[] = provinceData;
const byName = new Map(provinces.map(province => [province.name, province]));

export function findProvince(name: string) {
  return byName.get(name) ?? null;
}

export function districtsOf(province: string): readonly string[] {
  return byName.get(province)?.districts ?? [];
}

/** The option whose name equals `text` ignoring case (Turkish rules), for text the browser filled in; null otherwise. */
export function matchName(options: readonly string[], text: string) {
  const wanted = text.trim().toLocaleLowerCase("tr");
  return wanted ? options.find(option => option.toLocaleLowerCase("tr") === wanted) ?? null : null;
}

/** "<açık adres>, <posta kodu> <İlçe>/<İl>": the combined text kept in commerce_orders.address and the agreement. */
export function composeAddress({ line, district, province, postalCode }: { line: string; district: string; province: string; postalCode: string | null }) {
  return `${line}, ${[postalCode, `${district}/${province}`].filter(Boolean).join(" ")}`;
}

export const invoiceTypes = { individual: "Bireysel", corporate: "Kurumsal" } as const;
export type InvoiceType = keyof typeof invoiceTypes;

export type InvoiceDetails = { invoice_type: InvoiceType | null; invoice_company: string | null; invoice_tax_no: string | null; invoice_tax_office: string | null };

/** "<unvan> · VKN <no> · <vergi dairesi> V.D." for a corporate invoice; null for an individual one or an order without it. */
export function invoiceSummary(order: InvoiceDetails) {
  if (order.invoice_type !== "corporate") return null;
  return `${order.invoice_company} · VKN ${order.invoice_tax_no} · ${order.invoice_tax_office} V.D.`;
}
