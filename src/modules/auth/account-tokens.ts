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

/** Where an e-mail verification leads (#1258): the safe return path and the sha256 of the signup browser's nonce. */
export type AccountTokenExtra = { returnTo?: string | null; originHash?: string | null };

/** Issues a new token valid for `ttlMinutes`; it replaces the account's earlier tokens of this purpose. Returns the raw token. */
export async function issueAccountToken(client: Queryable, accountId: string, purpose: AccountTokenPurpose, ttlMinutes: number, extra: AccountTokenExtra = {}) {
  const token = randomBytes(32).toString("base64url");
  // One statement: the earlier tokens go with the insert. Two concurrent requests under READ COMMITTED can still both
  // insert, leaving two live tokens; harmless, since completing either deletes all of the account's tokens.
  await client.query(`WITH replaced AS (DELETE FROM account_tokens WHERE account_id=$2 AND purpose=$3)
    INSERT INTO account_tokens (token_hash,account_id,purpose,expires_at,return_to,origin_hash) VALUES ($1,$2,$3,now()+make_interval(mins=>$4::int),$5,$6)`,
    [hashOf(token), accountId, purpose, ttlMinutes, extra.returnTo ?? null, extra.originHash ?? null]);
  return token;
}

/** Withdraws this one token (expired or not), e.g. after its e-mail could not be sent. */
export async function revokeAccountToken(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  if (!usable(token)) return;
  await client.query("DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2", [hashOf(token), purpose]);
}

/** The unexpired token's account, expiry and signup origin, without using it up; null for an unknown, expired or malformed token. */
export async function findAccountToken(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  if (!usable(token)) return null;
  const { rows } = await client.query<{ account_id: string; expires_at: Date; origin_hash: string | null }>(
    "SELECT account_id,expires_at,origin_hash FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now()", [hashOf(token), purpose]);
  return rows[0] ? { accountId: rows[0].account_id, expiresAt: rows[0].expires_at, originHash: rows[0].origin_hash } : null;
}

/**
 * Locks the account of an unexpired token (FOR NO KEY UPDATE) inside the caller's transaction and returns its id.
 * Completing a link takes this first, so every path locks the account row before its tokens, as deleting an account
 * does. NO KEY: it still blocks an account DELETE but not the FOR KEY SHARE of a concurrent token insert (FK check).
 */
export async function lockTokenAccount(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  if (!usable(token)) return null;
  const { rows } = await client.query<{ id: string }>(`SELECT a.id FROM account_tokens t JOIN accounts a ON a.id=t.account_id
    WHERE t.token_hash=$1 AND t.purpose=$2 AND t.expires_at>now() FOR NO KEY UPDATE OF a`, [hashOf(token), purpose]);
  return rows[0]?.id ?? null;
}

/** Uses the token up: its account and stored extras if it was unexpired, otherwise null. A token works only once. */
export async function consumeAccountTokenDetails(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  if (!usable(token)) return null;
  const { rows } = await client.query<{ account_id: string; return_to: string | null; origin_hash: string | null }>(
    "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING account_id,return_to,origin_hash", [hashOf(token), purpose]);
  const row = rows[0];
  return row ? { accountId: row.account_id, returnTo: row.return_to, originHash: row.origin_hash } : null;
}

/** Uses the token up: its account id if it was unexpired, otherwise null. A token works only once. */
export async function consumeAccountToken(client: Queryable, token: string, purpose: AccountTokenPurpose) {
  return (await consumeAccountTokenDetails(client, token, purpose))?.accountId ?? null;
}
