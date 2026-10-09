import {z} from "zod";

export const newsletterConsentText="Getirbakim’den bülten, kampanya ve diğer pazarlama e-postalarını almayı kabul ediyorum.";
export const newsletterConsentVersion="2026-10-07";
export const newsletterSchema=z.object({
  email:z.string().trim().max(254).pipe(z.email()).transform(email=>email.toLowerCase()),
  consent:z.literal("on"),
  website:z.literal(""),
});
export type NewsletterState={status:"idle"|"success"|"error";message:string};
