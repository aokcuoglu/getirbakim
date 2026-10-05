"use server";
import { compare, hash } from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { startSession, tokenHash } from "@/modules/auth/session";
import { loginSchema } from "./schemas";
import { mergeGuestCart } from "@/modules/store/cart";
export async function login(form: FormData) {
 const parsed=loginSchema.safeParse(Object.fromEntries(form));
 if (!parsed.success) redirect("/giris?error=1");
 const {email,password}=parsed.data; const normalized=email.toLowerCase();
 const attempts=await db.query("INSERT INTO login_attempts (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END, window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts",[normalized]);
 if (attempts.rows[0].attempts>5) redirect("/giris?error=limit");
 const {rows}=await db.query("SELECT id,password_hash,approved FROM accounts WHERE email=$1",[normalized]);
 const valid=await compare(password, rows[0]?.password_hash ?? await hash("nonexistent-account-placeholder",12));
 if (!valid || !rows[0]?.approved) redirect("/giris?error=1");
 await db.query("DELETE FROM login_attempts WHERE email=$1",[normalized]);
 const old=(await cookies()).get("gb_session")?.value;
 if(old) await db.query("DELETE FROM sessions WHERE token_hash=$1",[tokenHash(old)]);
 await mergeGuestCart(rows[0].id);
 await startSession(rows[0].id); redirect("/");
}
export async function logout() {
 const jar=await cookies(); const token=jar.get("gb_session")?.value;
 if(token) await db.query("DELETE FROM sessions WHERE token_hash=$1",[tokenHash(token)]);
 jar.delete("gb_session");redirect("/");
}
