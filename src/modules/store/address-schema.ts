import { z } from "zod";
import { phonePattern } from "./checkout-schema";
import { checkoutFieldErrors } from "./checkout-field-errors";
import { addressProblem } from "./tr-address";

const checkbox = z.literal("on").optional().transform(value => value === "on");

/** What to fix when the server refuses a field, by field name; `limit` is the full address book. */
export const addressFieldErrors = {
  label: "Adres başlığını yaz.",
  recipientName: "Alıcı ad soyadını yaz.",
  phone: checkoutFieldErrors.phone,
  province: "İl seç.",
  district: checkoutFieldErrors.district,
  addressLine: checkoutFieldErrors.addressLine,
  postalCode: checkoutFieldErrors.postalCode,
  limit: "Adres defterin dolu. Yeni adres eklemek için önce bir adresini sil.",
} as const;

/**
 * A saved address of the /hesap/adresler form (#950): a label, the recipient's name and phone, and the structured address
 * of checkout (province, district, street address, optional postal code). The two boxes ask to make it the default
 * delivery or invoice address; an unticked box is absent from the form data. An empty postal code is stored as null.
 */
export const addressInput = z.object({
  label: z.string().trim().min(1).max(60),
  recipientName: z.string().trim().min(2).max(150),
  phone: z.string().trim().regex(phonePattern),
  province: z.string().trim(),
  district: z.string().trim(),
  addressLine: z.string().trim().min(10).max(500),
  postalCode: z.string().trim().regex(/^(\d{5})?$/).optional().default(""),
  defaultDelivery: checkbox,
  defaultInvoice: checkbox,
}).superRefine((input, ctx) => {
  const problem = addressProblem(input);
  if (problem) ctx.addIssue({ code: "custom", path: [problem], message: addressFieldErrors[problem] });
}).transform(({ postalCode, ...input }) => ({ ...input, postalCode: postalCode || null }));

export type AddressInput = z.output<typeof addressInput>;

export type AddressErrorField = keyof typeof addressFieldErrors;

/** The first refused field that has its own message, if any. */
export function addressErrorField(issues: readonly { path: readonly PropertyKey[] }[]): AddressErrorField | undefined {
  const field = issues.map(issue => issue.path[0]).find(key => typeof key === "string" && Object.hasOwn(addressFieldErrors, key));
  return typeof field === "string" ? field as AddressErrorField : undefined;
}
