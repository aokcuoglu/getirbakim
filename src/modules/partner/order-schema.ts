import { z } from "zod";
import { normalizePhone } from "@/modules/shipping/geliver-request";
import { composeAddress, districtsOf, matchName, postalCodeFits, provinces } from "@/modules/store/tr-address";
import { maxPartnerLineQuantity, maxPartnerOrderLines } from "./quotes";

/**
 * Request bodies of the partner order API (#426, docs/partner-order-contract.md). Strict: unknown fields, a partner
 * identity in the body or the same offer on two lines are refused. Pure, so scripts/test-partner.ts covers it.
 */
const offerId = z.string().regex(/^offer_[0-9a-f]{32}$/);
const quantity = z.number().int().min(1).max(maxPartnerLineQuantity);
const distinctOffers = (lines: { selectedOfferId: string }[]) => new Set(lines.map(line => line.selectedOfferId)).size === lines.length;
const distinctMessage = { message: "Each offer may appear on one line only." };

export const quoteRequestSchema = z.object({
  lines: z.array(z.object({ selectedOfferId: offerId, quantity }).strict()).min(1).max(maxPartnerOrderLines).refine(distinctOffers, distinctMessage),
}).strict();
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/**
 * The workshop the parts are shipped to. The phone must be a Turkish number (stored normalized). Province and district are matched to the Turkish address list ignoring case
 * and returned with its spelling; a postal code must belong to the province.
 */
const shippingAddressSchema = z.object({
  recipientName: z.string().trim().min(2).max(150),
  // The storefront's form rule, then the Turkish number the carrier label needs (normalizePhone): stored as +90XXXXXXXXXX.
  phone: z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/),
  email: z.email().max(200).optional(),
  province: z.string().trim().max(100),
  district: z.string().trim().max(100),
  addressLine: z.string().trim().min(10).max(500),
  postalCode: z.string().trim().regex(/^\d{5}$/).optional(),
}).strict().transform((address, ctx) => {
  const provinceName = matchName(provinces.map(province => province.name), address.province);
  const province = provinces.find(item => item.name === provinceName);
  if (!province) { ctx.addIssue({ code: "custom", path: ["province"], message: "Unknown province." }); return z.NEVER; }
  const district = matchName(districtsOf(province.name), address.district);
  if (!district) { ctx.addIssue({ code: "custom", path: ["district"], message: "Unknown district for the province." }); return z.NEVER; }
  if (address.postalCode && !postalCodeFits(address.postalCode, province)) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: "Postal code does not belong to the province." }); return z.NEVER;
  }
  const phone = normalizePhone(address.phone);
  if (!phone) { ctx.addIssue({ code: "custom", path: ["phone"], message: "Not a Turkish phone number." }); return z.NEVER; }
  // commerce_orders.email is NOT NULL (store orders always have one): a partner order without one stores "".
  return { ...address, phone, province: province.name, district, email: address.email ?? "", postalCode: address.postalCode ?? null };
});
export type PartnerShippingAddress = z.output<typeof shippingAddressSchema>;

export const orderRequestSchema = z.object({
  confirmationToken: z.string().min(1).max(8192),
  lines: z.array(z.object({ selectedOfferId: offerId, quantity, expectedUnitNetKurus: z.number().int().positive() }).strict())
    .min(1).max(maxPartnerOrderLines).refine(distinctOffers, distinctMessage),
  shippingAddress: shippingAddressSchema,
  note: z.string().trim().max(1000).optional().default(""),
}).strict();
export type OrderRequest = z.output<typeof orderRequestSchema>;

/** commerce_orders.address: the same combined text the storefront stores. */
export function addressText(address: PartnerShippingAddress) {
  return composeAddress({ line: address.addressLine, district: address.district, province: address.province, postalCode: address.postalCode });
}
