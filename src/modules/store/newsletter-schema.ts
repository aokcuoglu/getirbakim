import {z} from "zod";

export {newsletterConsentText,newsletterConsentVersion,type NewsletterState} from "./newsletter-consent";
export const newsletterSchema=z.object({
  email:z.string().trim().max(254).pipe(z.email()).transform(email=>email.toLowerCase()),
  consent:z.literal("on"),
  website:z.literal(""),
});
