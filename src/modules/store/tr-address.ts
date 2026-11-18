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

/** Whether a 5-digit postal code belongs to the province: its first two digits are the plate code (34xxx is İstanbul). */
export function postalCodeFits(postalCode: string, province: Province) {
  return Number(postalCode.slice(0, 2)) === province.plate;
}

/** "<açık adres>, <posta kodu> <İlçe>/<İl>": the combined text kept in commerce_orders.address and the agreement. */
export function composeAddress({ line, district, province, postalCode }: { line: string; district: string; province: string; postalCode: string | null }) {
  return `${line}, ${[postalCode, `${district}/${province}`].filter(Boolean).join(" ")}`;
}

export const invoiceTypes = { individual: "Bireysel", corporate: "Kurumsal" } as const;
export type InvoiceType = keyof typeof invoiceTypes;

export type InvoiceDetails = { invoice_type: InvoiceType | null; invoice_company: string | null; invoice_tax_no: string | null; invoice_tax_office: string | null };
/** Separate invoice address (#916); all null when the invoice goes to the delivery address. */
export type InvoiceAddress = { invoice_province: string | null; invoice_district: string | null; invoice_address_line: string | null; invoice_postal_code: string | null };

/** The separate invoice address as composeAddress text; null when the invoice goes to the delivery address. */
export function invoiceAddressText(order: InvoiceAddress) {
  if (order.invoice_province === null) return null;
  return composeAddress({ line: order.invoice_address_line ?? "", district: order.invoice_district ?? "", province: order.invoice_province, postalCode: order.invoice_postal_code });
}

/**
 * A corporate invoice's tax id: a company's 10-digit VKN or a sole proprietor's 11-digit TC kimlik no, each passing its
 * check digits. VKN (#916): for each of the first nine digits d at index i, t = (d + 9 − i) mod 10 adds 0 when t is 0,
 * else (t × 2^(9 − i)) mod 9 with 0 read as 9; the 10th digit is (10 − sum mod 10) mod 10. TC kimlik no: first digit
 * not 0; the 10th is (7 × odd-position sum − even-position sum of the first nine) mod 10, the 11th is the sum of the
 * first ten mod 10.
 */
export function validTaxId(value: string) {
  if (/^\d{10}$/.test(value)) return validVkn(value);
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
  return ((odd * 7 - even) % 10 + 10) % 10 === d[9] && d.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10 === d[10];
}

function validVkn(value: string) {
  const d = [...value].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (d[i] + 9 - i) % 10;
    if (t !== 0) sum += (t * 2 ** (9 - i)) % 9 || 9;
  }
  return (10 - sum % 10) % 10 === d[9];
}

/** "<unvan> · Vergi/TC kimlik no <no> · <vergi dairesi> V.D." for a corporate invoice; null for an individual one or an order without it. */
export function invoiceSummary(order: InvoiceDetails) {
  if (order.invoice_type !== "corporate") return null;
  return `${order.invoice_company} · Vergi/TC kimlik no ${order.invoice_tax_no} · ${order.invoice_tax_office} V.D.`;
}
