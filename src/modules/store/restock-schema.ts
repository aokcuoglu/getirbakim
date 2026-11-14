import {z} from "zod";

// "Gelince haber ver" (#475): a one-time notice that the product can be ordered again; not a marketing consent.
export const restockConsentText="Bu ürün yeniden satışa sunulduğunda bana bir kez bilgilendirme e-postası gönderilmesi için e-posta adresimin işlenmesini kabul ediyorum.";
export const restockConsentVersion="2026-11-14";
export const restockRequestSchema=z.object({
  productId:z.uuid(),
  email:z.string().trim().max(254).pipe(z.email()).transform(email=>email.toLowerCase()),
  consent:z.literal("on"),
  website:z.literal(""),
});
export type RestockRequestInput=z.input<typeof restockRequestSchema>;
export type RestockState={status:"idle"|"success"|"error";message:string};
