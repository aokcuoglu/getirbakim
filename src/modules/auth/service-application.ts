"use server";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { loginPath } from "./return-to";
import { serviceApplicationSchema, serviceUpgradeSchema } from "./schemas";
import { currentAccount } from "./session";

// Persisted attempt budget shared across workers: true when any of `limits`' keys is over its hourly limit.
async function overBudget(limits: Record<string, number>) {
  const budget = await db.query<{ key: string; attempts: number }>(`INSERT INTO service_application_attempts AS a (key,attempts)
    SELECT unnest($1::text[]),1 ON CONFLICT (key) DO UPDATE SET
    attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
    window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END
    RETURNING key,attempts`, [Object.keys(limits)]);
  return budget.rows.some(row => row.attempts > limits[row.key]);
}

export async function applyForService(form: FormData) {
  const parsed = serviceApplicationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/servisler/basvuru?error=validation");
  const { name, contactName, city, phone, email, password } = parsed.data;
  const key = createHash("sha256").update(email).digest("hex");
  // Both a global burst budget and an email budget are persisted across workers.
  if (await overBudget({ global: 100, [key]: 3 })) redirect("/servisler/basvuru?error=limit");
  const created = await db.query(`INSERT INTO accounts (name,email,password_hash,role,approved,discount_percent,contact_name,phone,city,applied_at)
    VALUES ($1,$2,$3,'service',false,0,$4,$5,$6,now()) ON CONFLICT (email) DO NOTHING RETURNING id`,
    [name,email,await hash(password,12),contactName,phone,city]);
  if (!created.rowCount) {
    // An individual customer applies from the account instead (#1259). Saying so reveals no more than customer signup
    // already does for any taken address (#1254); service and admin addresses still get the neutral answer below.
    const existing = await db.query<{ role: string }>("SELECT role FROM accounts WHERE email=$1", [email]);
    if (existing.rows[0]?.role === "customer") redirect("/servisler/basvuru?error=account");
  }
  // Never log in pending accounts, and do not say whether a service or admin account already uses the address.
  redirect("/servisler/basvuru?sent=1");
}

/** A signed-in individual customer asks for the same account to become a service account (#1259). */
export async function applyForServiceUpgrade(form: FormData) {
  const account = await currentAccount();
  if (!account?.approved) redirect(loginPath("/servisler/basvuru"));
  if (account.role !== "customer") redirect("/servisler/basvuru");
  const parsed = serviceUpgradeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/servisler/basvuru?error=validation");
  if (await overBudget({ [`upgrade:${account.id}`]: 3 })) redirect("/servisler/basvuru?error=limit");
  const { name, contactName, phone, city } = parsed.data;
  // The role is checked again in the statement; an open request keeps its first values until an admin decides.
  await db.query(`INSERT INTO service_upgrade_requests (account_id,service_name,contact_name,phone,city)
    SELECT id,$2,$3,$4,$5 FROM accounts WHERE id=$1 AND role='customer' AND approved ON CONFLICT (account_id) DO NOTHING`,
    [account.id, name, contactName, phone, city]);
  // The dashboard list and the sidebar's waiting-approval count live under the /yonetim layout.
  revalidatePath("/yonetim", "layout");
  redirect("/servisler/basvuru?sent=1");
}
