import {z} from "zod";

export {restockConsentText,restockConsentVersion,type RestockState} from "./restock-consent";
export const restockRequestSchema=z.object({
  productId:z.uuid(),
  email:z.string().trim().max(254).pipe(z.email()).transform(email=>email.toLowerCase()),
  consent:z.literal("on"),
  website:z.literal(""),
});
export type RestockRequestInput=z.input<typeof restockRequestSchema>;
