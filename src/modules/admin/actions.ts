"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { hash } from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceSchema } from "@/modules/auth/schemas";
import { approveServiceAccount, rejectServiceUpgrade } from "./service-accounts";
export async function createService(form: FormData) {
 await requireAdmin();
 const input=createServiceSchema.safeParse(Object.fromEntries(form));
 if (!input.success) redirect("/yonetim/servisler?error=validation");
 const {name,email,password,discount}=input.data;
 const result=await db.query("INSERT INTO accounts (name,email,password_hash,role,approved,discount_percent) VALUES ($1,$2,$3,'service',true,$4) ON CONFLICT (email) DO NOTHING",[name,email.toLowerCase(),await hash(password,12),discount]);
 // Service lists and the sidebar's waiting-approval count live under the /yonetim layout.
 if(result.rowCount) revalidatePath("/yonetim","layout");
 redirect(result.rowCount ? "/yonetim/servisler?created=1" : "/yonetim/servisler?error=duplicate");
}

export async function approveService(form: FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),discount:z.coerce.number().int().min(0).max(50)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect("/yonetim?error=validation");
 const approved=await approveServiceAccount(input.data.id,input.data.discount);
 if(approved) revalidatePath("/yonetim","layout");
 redirect(approved ? "/yonetim?approved=1" : "/yonetim?error=validation");
}

/** Rejects an individual customer's service-account request (#1259); the account stays a customer. */
export async function rejectServiceApplication(form: FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect("/yonetim?error=validation");
 const rejected=await rejectServiceUpgrade(input.data.id);
 if(rejected) revalidatePath("/yonetim","layout");
 redirect(rejected ? "/yonetim?rejected=1" : "/yonetim?error=validation");
}
