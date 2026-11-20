// Kept apart from newsletter-schema.ts so the client form does not pull zod into the storefront bundle (#968).
export const newsletterConsentText="Getirbakim’den bülten, kampanya ve diğer pazarlama e-postalarını almayı kabul ediyorum.";
export const newsletterConsentVersion="2026-10-07";
export type NewsletterState={status:"idle"|"success"|"error";message:string};
