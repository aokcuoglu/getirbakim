// Kept apart from restock-schema.ts so the client form does not pull zod into the storefront bundle (#968).
// "Gelince haber ver" (#475): a one-time notice that the product can be ordered again; not a marketing consent.
export const restockConsentText="Bu ürün yeniden satışa sunulduğunda bana bir kez bilgilendirme e-postası gönderilmesi için e-posta adresimin işlenmesini kabul ediyorum.";
export const restockConsentVersion="2026-11-14";
export type RestockState={status:"idle"|"success"|"error";message:string};
