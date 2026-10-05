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
