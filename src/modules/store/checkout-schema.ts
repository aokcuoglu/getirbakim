import { z } from "zod";
import { composeAddress, districtsOf, findProvince, postalCodeFits, validTaxId } from "./tr-address";
export { checkoutErrorField, checkoutFieldErrors } from "./checkout-field-errors";

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

/**
 * Checkout form fields; `consent` is the pre-contract checkbox and must be ticked. The delivery address is taken as
 * province, district, street address and optional postal code (#881) and also combined into `address`; the invoice is
 * individual or corporate, the corporate one with title, tax id (10-digit VKN, or a sole proprietor's 11-digit TC kimlik no, either passing its check digits) and tax office. `installments` is the chosen
 * payment option (#886).
 */
export const checkoutInput=z.object({requestKey:z.uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(2).max(150),email:z.email().max(200),phone:z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/),
 province:z.string().trim(),district:z.string().trim(),addressLine:z.string().trim().min(10).max(500),postalCode:z.string().trim().regex(/^(\d{5})?$/).optional().default(""),
 note:z.string().trim().max(1000),invoiceType:z.enum(["individual","corporate"]),invoiceCompany:optionalText(200),invoiceTaxNo:optionalText(11),invoiceTaxOffice:optionalText(100),
 consent:z.literal('on'),installments:z.coerce.number().int().min(1).max(12).default(1)}).superRefine((input,ctx)=>{
 const province=findProvince(input.province);
 if(!province) ctx.addIssue({code:"custom",path:["province"],message:"İl seç."});
 else if(!districtsOf(province.name).includes(input.district)) ctx.addIssue({code:"custom",path:["district"],message:"İlçe seç."});
 // A postal code starts with the province's plate code (34xxx is İstanbul).
 if(province && input.postalCode && !postalCodeFits(input.postalCode,province)) ctx.addIssue({code:"custom",path:["postalCode"],message:"Posta kodu ille uyuşmuyor."});
 if(input.invoiceType==="corporate") {
  if(input.invoiceCompany.length<2) ctx.addIssue({code:"custom",path:["invoiceCompany"],message:"Fatura unvanını yaz."});
  if(!validTaxId(input.invoiceTaxNo)) ctx.addIssue({code:"custom",path:["invoiceTaxNo"],message:"Geçerli 10 haneli VKN ya da geçerli 11 haneli TC kimlik no gir."});
  if(input.invoiceTaxOffice.length<2) ctx.addIssue({code:"custom",path:["invoiceTaxOffice"],message:"Vergi dairesini yaz."});
 }
}).transform(({invoiceCompany,invoiceTaxNo,invoiceTaxOffice,postalCode,...input})=>{
 const corporate=input.invoiceType==="corporate", postal=postalCode || null;
 return {...input,postalCode:postal,address:composeAddress({line:input.addressLine,district:input.district,province:input.province,postalCode:postal}),
  invoiceCompany:corporate ? invoiceCompany : null,invoiceTaxNo:corporate ? invoiceTaxNo : null,invoiceTaxOffice:corporate ? invoiceTaxOffice : null};
});

/** Plain text of the checkout consent label (siparis-olustur), stored with each order as what the buyer ticked. */
export const checkoutConsentText="Ön bilgilendirme formunu ve mesafeli satış sözleşmesini okudum, onaylıyorum. Ödemenin TAMI güvenli ödeme sayfasında alınacağını; tedarikçi stoku teyit edilemezse siparişin iptal edilip ödemenin iade edileceğini biliyorum.";
