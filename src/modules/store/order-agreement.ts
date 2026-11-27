import { createHash } from "node:crypto";
import { legalDocument, type LegalDocument, type LegalNode } from "@/content/legal";
import { money } from "./money";

/**
 * Order-specific pre-contract documents (#604): the Ön Bilgilendirme Formu and Mesafeli Satış Sözleşmesi with the
 * buyer, lines, prices and totals filled in, built once when the order is placed and stored as an immutable copy.
 * Bump AGREEMENT_TEMPLATE_VERSION whenever the code-generated sections below change wording or structure.
 */
export const AGREEMENT_TEMPLATE_VERSION = 4;
export const agreementSlugs = ["on-bilgilendirme-formu", "mesafeli-satis-sozlesmesi"] as const;
type AgreementSlug = (typeof agreementSlugs)[number];
type LegalSection = LegalDocument["sections"][number];
export type AgreementSources = Record<AgreementSlug, Pick<LegalDocument, "title" | "updatedAt" | "sections" | "company">>;
export type OrderAgreementDocument = {
  schema: 1;
  documents: { slug: AgreementSlug; title: string; updatedAt: string; sections: LegalSection[] }[];
};
export type AgreementOrder = {
  number: string | number; createdAt: Date; name: string; email: string; phone: string; address: string; note: string;
  /** Corporate invoice details (#881); absent or null for an individual invoice. */
  invoice?: { company: string; taxNo: string; taxOffice: string } | null;
  /** Separate invoice address text (#916); absent or null when the invoice goes to the delivery address. */
  invoiceAddress?: string | null;
  discountPercent: number; subtotalKurus: number; shippingKurus: number; totalKurus: number;
  /** Set only for an installment order (#886); totalKurus then includes installmentFeeKurus. */
  installmentCount?: number; installmentFeeKurus?: number;
};
export type AgreementLine = { name: string; brand: string; code: string; quantity: number; unitPriceKurus: number };

const sellerSection = "Satıcı Bilgileri";
// Both say the page is generic and the order-specific details are given separately; the stored copy is that copy.
const genericOnlySections = new Set(["Kapsam ve Bilgilendirme", "Siparişe Özgü Bilgiler"]);

export function defaultSources(): AgreementSources {
  const [preContract, contract] = agreementSlugs.map(slug => {
    const page = legalDocument(slug);
    if (!page) throw new Error(`Legal page missing: ${slug}`);
    return page;
  });
  return { "on-bilgilendirme-formu": preContract, "mesafeli-satis-sozlesmesi": contract };
}

/** `<latest updatedAt of the two pages>.<hash of template version + both pages>`; any text edit changes it. */
export function legalTextVersion(sources: AgreementSources = defaultSources()) {
  const preContract = sources["on-bilgilendirme-formu"], contract = sources["mesafeli-satis-sozlesmesi"];
  const latest = [preContract.updatedAt, contract.updatedAt].sort().at(-1);
  const hash = createHash("sha256").update(JSON.stringify([AGREEMENT_TEMPLATE_VERSION, preContract, contract])).digest("hex").slice(0, 12);
  return `${latest}.${hash}`;
}

const p = (...children: LegalNode[]): LegalNode => ({ tag: "p", attrs: {}, children });
const strong = (text: string): LegalNode => ({ tag: "strong", attrs: {}, children: [text] });
const field = (label: string, value: string) => p(strong(`${label}: `), value);
const istanbulTime = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

function buyerSection(order: AgreementOrder): LegalSection {
  return { title: "Alıcı Bilgileri", blocks: [
    field("Ad soyad", order.name), field("E-posta", order.email), field("Telefon", order.phone), field("Teslimat adresi", order.address),
    field("Fatura adresi", order.invoiceAddress ?? order.address),
    ...(order.invoice ? [field("Fatura unvanı", order.invoice.company), field("Vergi/TC kimlik no", order.invoice.taxNo), field("Vergi dairesi", order.invoice.taxOffice)] : []),
  ] };
}

function orderSection(order: AgreementOrder, lines: AgreementLine[]): LegalSection {
  const items: LegalNode = { tag: "ul", attrs: {}, children: lines.map(line => ({ tag: "li", attrs: {}, children: [
    `${line.quantity} × ${line.name} (${[line.brand, line.code].filter(Boolean).join(" ")}) — birim fiyat ${money(line.unitPriceKurus)} — tutar ${money(line.unitPriceKurus * line.quantity)}`,
  ] })) };
  const installments = order.installmentCount ?? 1;
  return { title: "Sipariş Bilgileri", blocks: [
    field("Sipariş numarası", `#${order.number}`),
    field("Sipariş tarihi", istanbulTime(order.createdAt)),
    p(strong("Ürünler (adet × ürün, birim fiyat ve tutar KDV dahil):")),
    items,
    field("Ürün toplamı", money(order.subtotalKurus)),
    ...(order.discountPercent > 0 ? [field("Servis indirimi", `%${order.discountPercent} (birim fiyatlara uygulanmıştır)`)] : []),
    field("Kargo", order.shippingKurus > 0 ? money(order.shippingKurus) : "Ücretsiz"),
    ...(installments > 1 && (order.installmentFeeKurus ?? 0) > 0 ? [field(`Vade farkı (${installments} taksit)`, money(order.installmentFeeKurus ?? 0))] : []),
    field("Ödenecek toplam (tüm vergiler dahil)", money(order.totalKurus)),
    field("Ödeme", installments > 1 ? `Kart ile, TAMI ortak ödeme sayfasında ${installments} taksitle ödeme${(order.installmentFeeKurus ?? 0) > 0 ? "" : " (vade farksız)"}` : "Kart ile, TAMI ortak ödeme sayfasında peşin ödeme"),
    field("Teslimat adresi", order.address),
    ...(order.note ? [field("Sipariş notu", order.note)] : []),
  ] };
}

/** Builds the self-contained document stored with the order; viewing it never reads the current legal pages. */
export function buildOrderAgreement(order: AgreementOrder, lines: AgreementLine[], sources: AgreementSources = defaultSources()): OrderAgreementDocument {
  const buyer = buyerSection(order), details = orderSection(order, lines);
  return { schema: 1, documents: agreementSlugs.map(slug => {
    const source = sources[slug];
    const seller = source.sections.find(section => section.title === sellerSection) ?? { title: sellerSection, blocks: source.company };
    const rest = source.sections.filter(section => section.title !== sellerSection && !genericOnlySections.has(section.title));
    return { slug, title: source.title, updatedAt: source.updatedAt, sections: [seller, buyer, details, ...rest] };
  }) };
}
