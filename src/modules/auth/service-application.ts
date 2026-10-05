"use server";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { serviceApplicationSchema } from "./schemas";
export async function applyForService(form: FormData) {
  const parsed = serviceApplicationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/servisler/basvuru?error=validation");
  const { name, contactName, city, phone, email, password } = parsed.data;
  const key = createHash("sha256").update(email).digest("hex");
  // Both a global burst budget and an email budget are persisted across workers.
  const budget = await db.query<{ key: string; attempts: number }>(`INSERT INTO service_application_attempts AS a (key,attempts)
    VALUES ('global',1),($1,1) ON CONFLICT (key) DO UPDATE SET
    attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
    window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END
    RETURNING key,attempts`, [key]);
  if (budget.rows.some(row => row.attempts > (row.key === "global" ? 100 : 3))) redirect("/servisler/basvuru?error=limit");
  await db.query(`INSERT INTO accounts (name,email,password_hash,role,approved,discount_percent,contact_name,phone,city,applied_at)
    VALUES ($1,$2,$3,'service',false,0,$4,$5,$6,now()) ON CONFLICT (email) DO NOTHING`,
    [name,email,await hash(password,12),contactName,phone,city]);
  // Do not disclose whether an address already has an account, and never log in pending accounts.
  redirect("/servisler/basvuru?sent=1");
}
