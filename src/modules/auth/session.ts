import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { cache } from "react";
export type Account = { id: string; name: string; email: string; role: "admin" | "service"; approved: boolean; discount_percent: number };
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const currentAccount = cache(async (): Promise<Account | null> => {
 const token = (await cookies()).get("gb_session")?.value;
 if (!token) return null;
 const { rows } = await db.query<Account>("SELECT a.id,a.name,a.email,a.role,a.approved,a.discount_percent FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>now()", [tokenHash(token)]);
 return rows[0] ?? null;
});
export async function requireService() {
 const account = await currentAccount();
 if (!account?.approved) redirect("/giris");
 return account;
}
export async function requireAdmin() {
 const account = await requireService();
 if (account.role !== "admin") redirect("/");
 return account;
}
export async function startSession(accountId: string) {
 const token = randomBytes(32).toString("hex");
 await db.query("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '30 minutes')",[tokenHash(token),accountId]);
 (await cookies()).set("gb_session",token,{httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"lax",maxAge:1800,path:"/"});
}
