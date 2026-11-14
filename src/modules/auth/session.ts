import "server-only";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loginPath, RETURN_TO_HEADER } from "./return-to";
import { SESSION_COOKIE, SESSION_IDLE_SECONDS, sessionCookieOptions } from "./session-cookie";
export type Account = { id: string; name: string; email: string; role: "admin" | "service"; approved: boolean; discount_percent: number };
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const currentAccount = cache(async (): Promise<Account | null> => {
 const token = (await cookies()).get(SESSION_COOKIE)?.value;
 if (!token) return null;
 // Sliding expiry: every authenticated request pushes the expiry to SESSION_IDLE_SECONDS from now, written at most once a minute.
 const { rows } = await db.query<Account>(`WITH touched AS (UPDATE sessions SET expires_at=now()+make_interval(secs=>$2::int) WHERE token_hash=$1 AND expires_at>now() AND expires_at<now()+make_interval(secs=>$2::int-60))
  SELECT a.id,a.name,a.email,a.role,a.approved,a.discount_percent FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>now()`, [tokenHash(token), SESSION_IDLE_SECONDS]);
 return rows[0] ?? null;
});
export async function requireService() {
 const account = await currentAccount();
 if (!account?.approved) redirect(loginPath((await headers()).get(RETURN_TO_HEADER)));
 return account;
}
export async function requireAdmin() {
 const account = await requireService();
 if (account.role !== "admin") redirect("/");
 return account;
}
export async function startSession(accountId: string) {
 const token = randomBytes(32).toString("hex");
 await db.query("INSERT INTO sessions (token_hash,account_id,expires_at) VALUES ($1,$2,now()+make_interval(secs=>$3::int))",[tokenHash(token),accountId,SESSION_IDLE_SECONDS]);
 (await cookies()).set(SESSION_COOKIE,token,sessionCookieOptions());
}
