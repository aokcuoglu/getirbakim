import { z } from "zod";

/** Checkout form fields; `consent` is the pre-contract checkbox and must be ticked. */
export const checkoutInput=z.object({requestKey:z.uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(2).max(150),email:z.email().max(200),phone:z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/),address:z.string().trim().min(15).max(1000),note:z.string().trim().max(1000),consent:z.literal('on')});

/** Plain text of the checkout consent label (siparis-olustur), stored with each order as what the buyer ticked. */
export const checkoutConsentText="Ön bilgilendirme formunu ve mesafeli satış sözleşmesini okudum, onaylıyorum. Ödemenin TAMI güvenli ödeme sayfasında alınacağını; tedarikçi stoku teyit edilemezse siparişin iptal edilip ödemenin iade edileceğini biliyorum.";
