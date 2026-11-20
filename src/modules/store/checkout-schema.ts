import { z } from "zod";
import { addressProblem, composeAddress, validTaxId } from "./tr-address";
export { checkoutErrorField, checkoutFieldErrors } from "./checkout-field-errors";

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");
/** A Turkish phone number as typed: 10–20 digits, spaces, brackets and dashes, optionally after "+". */
export const phonePattern = /^\+?[\d\s()-]{10,20}$/;
const deliveryMessages = { province: "İl seç.", district: "İlçe seç.", postalCode: "Posta kodu ille uyuşmuyor." } as const;
const invoiceFields = { province: "invoiceProvince", district: "invoiceDistrict", postalCode: "invoicePostalCode" } as const;
const invoiceMessages = { province: "Fatura ili seç.", district: "Fatura ilçesi seç.", postalCode: "Fatura posta kodu ille uyuşmuyor." } as const;

/**
 * Checkout form fields; `consent` is the pre-contract checkbox and must be ticked. The delivery address is taken as
 * province, district, street address and optional postal code (#881) and also combined into `address`; the invoice is
 * individual or corporate, the corporate one with title, tax id (10-digit VKN, or a sole proprietor's 11-digit TC kimlik no, either passing its check digits) and tax office. `installments` is the chosen
 * payment option (#886). `invoiceAddressMode` "separate" takes an invoice address with the same fields (#916), checked like
 * the delivery one and returned as `invoiceAddress`; "same" (the default) ignores any submitted invoice address fields and
 * returns `invoiceAddress: null`. `saveAddress` ("on" when ticked, #999) asks to keep the delivery address in the account's address book
 * under `saveAddressLabel`; both are best-effort, so a bad value never refuses the order.
 */
export const checkoutInput=z.object({requestKey:z.uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(2).max(150),email:z.email().max(200),phone:z.string().trim().regex(phonePattern),
 province:z.string().trim(),district:z.string().trim(),addressLine:z.string().trim().min(10).max(500),postalCode:z.string().trim().regex(/^(\d{5})?$/).optional().default(""),
 note:z.string().trim().max(1000),invoiceType:z.enum(["individual","corporate"]),invoiceCompany:optionalText(200),invoiceTaxNo:optionalText(11),invoiceTaxOffice:optionalText(100),
 consent:z.literal('on'),installments:z.coerce.number().int().min(1).max(12).default(1),
 invoiceAddressMode:z.enum(["same","separate"]).default("same"),invoiceProvince:optionalText(100),invoiceDistrict:optionalText(100),invoiceAddressLine:optionalText(500),
 invoicePostalCode:z.string().trim().regex(/^(\d{5})?$/).optional().default(""),
 saveAddress:z.literal("on").optional().catch(undefined).transform(value=>value==="on"),saveAddressLabel:optionalText(60).catch("")}).superRefine((input,ctx)=>{
 // A postal code starts with the province's plate code (34xxx is İstanbul).
 const delivery=addressProblem(input);
 if(delivery) ctx.addIssue({code:"custom",path:[delivery],message:deliveryMessages[delivery]});
 if(input.invoiceType==="corporate") {
  if(input.invoiceCompany.length<2) ctx.addIssue({code:"custom",path:["invoiceCompany"],message:"Fatura unvanını yaz."});
  if(!validTaxId(input.invoiceTaxNo)) ctx.addIssue({code:"custom",path:["invoiceTaxNo"],message:"Geçerli 10 haneli VKN ya da geçerli 11 haneli TC kimlik no gir."});
  if(input.invoiceTaxOffice.length<2) ctx.addIssue({code:"custom",path:["invoiceTaxOffice"],message:"Vergi dairesini yaz."});
 }
 if(input.invoiceAddressMode==="separate") {
  const invoice=addressProblem({province:input.invoiceProvince,district:input.invoiceDistrict,postalCode:input.invoicePostalCode});
  if(invoice && invoice!=="postalCode") ctx.addIssue({code:"custom",path:[invoiceFields[invoice]],message:invoiceMessages[invoice]});
  if(input.invoiceAddressLine.length<10) ctx.addIssue({code:"custom",path:["invoiceAddressLine"],message:"Fatura açık adresini yaz."});
  if(invoice==="postalCode") ctx.addIssue({code:"custom",path:["invoicePostalCode"],message:invoiceMessages.postalCode});
 }
}).transform(({invoiceCompany,invoiceTaxNo,invoiceTaxOffice,postalCode,invoiceAddressMode,invoiceProvince,invoiceDistrict,invoiceAddressLine,invoicePostalCode,...input})=>{
 const corporate=input.invoiceType==="corporate", postal=postalCode || null;
 return {...input,postalCode:postal,address:composeAddress({line:input.addressLine,district:input.district,province:input.province,postalCode:postal}),
  invoiceCompany:corporate ? invoiceCompany : null,invoiceTaxNo:corporate ? invoiceTaxNo : null,invoiceTaxOffice:corporate ? invoiceTaxOffice : null,
  invoiceAddress:invoiceAddressMode==="separate" ? {province:invoiceProvince,district:invoiceDistrict,addressLine:invoiceAddressLine,postalCode:invoicePostalCode || null} : null};
});

/** Plain text of the checkout consent label (siparis-olustur), stored with each order as what the buyer ticked. */
export const checkoutConsentText="Ön bilgilendirme formunu ve mesafeli satış sözleşmesini okudum, onaylıyorum. Ödemenin TAMI güvenli ödeme sayfasında alınacağını; tedarikçi stoku teyit edilemezse siparişin iptal edilip ödemenin iade edileceğini biliyorum.";
