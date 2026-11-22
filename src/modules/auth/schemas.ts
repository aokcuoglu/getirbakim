import { z } from "zod";
export const passwordSchema = z.string().min(1).max(72)
  .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Şifre en fazla 72 UTF-8 bayt olabilir.");
export const newPasswordSchema = passwordSchema.refine(value => value.length >= 12, "Şifre en az 12 karakter olmalı.");
export const emailSchema = z.email().max(200).transform(value => value.toLowerCase());
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const createServiceSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: emailSchema,
  password: newPasswordSchema,
  discount: z.coerce.number().int().min(0).max(50),
});
export const serviceApplicationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  contactName: z.string().trim().min(2).max(150),
  city: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\+?[\d ()-]{10,25}$/).refine(value => { const digits=value.replace(/\D/g, ""); return digits.length >= 10 && digits.length <= 15; }),
  email: emailSchema,
  password: newPasswordSchema,
  terms: z.literal("on"),
  website: z.string().max(0),
});
// A signed-in customer's request to become a service account (#1259): the account keeps its email and password.
export const serviceUpgradeSchema = serviceApplicationSchema.omit({ email: true, password: true, website: true });
// A signup name comes from an unverified form and later appears in the panel and the account's mails: no control
// characters or line breaks, and nothing that reads as a link or an address, so it cannot carry spam (#1258).
const signupName = z.string().trim().min(2).max(150)
  .refine(value => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) && !/:\/\/|www\.|@/i.test(value));
export const customerSignupSchema = z.object({
  name: signupName,
  email: emailSchema,
  password: newPasswordSchema,
  confirmPassword: z.string(),
  terms: z.literal("on"),
  website: z.string().max(0),
}).refine(value => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Şifreler aynı olmalı." });
export const resetRequestSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  password: newPasswordSchema,
  confirmPassword: z.string(),
}).refine(value => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Şifreler aynı olmalı." });
