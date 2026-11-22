import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

// Single-use account links (#1257, #1258; db/account-tokens.sql). The e-mail carries the raw token, the table only its
// sha256. Pure database helpers: the caller passes the pool or a transaction's client.
export type AccountTokenPurpose = "password_reset" | "email_verification";
type Queryable = Pick<PoolClient, "query">;

/** 32 random bytes in base64url are 43 characters; anything far longer is refused before hashing. */
export const ACCOUNT_TOKEN_MAX = 64;
const tokenShape = /^[A-Za-z0-9_-]+$/;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const usable = (token: string) => token.length > 0 && token.length <= ACCOUNT_TOKEN_MAX && tokenShape.test(token);

/** Issues a new token valid for `ttlMinutes`; it replaces the account's earlier tokens of this purpose. Returns the raw token. */
export async function issueAccountToken(client: Queryable, accountId: string, purpose: AccountTokenPurpose, ttlMinutes: number) {
  const token = randomBytes(32).toString("base64url");
  await client.query("DELETE FROM account_tokens WHERE account_id=$1 AND purpose=$2", [accountId, purpose]);
  await client.query("INSERT INTO account_tokens (token_hash,account_id,purpose,expires_at) VALUES ($1,$2,$3,now()+make_interval(mins=>$4::int))",
    [hashOf(token), accountId, purpose, ttlMinutes]);
  return token;
}

/** The unexpired token's account and expiry, without using it up; null for an unknown, expired or malformed token. */
export async function findAccountToken(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  if (!usable(token)) return null;
  const { rows } = await client.query<{ account_id: string; expires_at: Date }>(
    "SELECT account_id,expires_at FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now()", [hashOf(token), purpose]);
  return rows[0] ? { accountId: rows[0].account_id, expiresAt: rows[0].expires_at } : null;
}

/** Uses the token up: its account id if it was unexpired, otherwise null. A token works only once. */
export async function consumeAccountToken(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  if (!usable(token)) return null;
  const { rows } = await client.query<{ account_id: string }>(
    "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING account_id", [hashOf(token), purpose]);
  return rows[0]?.account_id ?? null;
}
