import type { Pool } from "pg";
import { UNVERIFIED_KEEP_DAYS } from "./verification-policy";

// Rate-limit rows (#1260): every window is at most an hour, so a row whose window started over a day ago can never
// affect a decision again. Both tables only ever grow otherwise. Account link tokens (#1257) go a day after they expire.
// Self-service signups never verified by e-mail (#1258) go after UNVERIFIED_KEEP_DAYS with their terms
// acceptance and tokens (ON DELETE CASCADE); one with an order is kept.
export async function pruneAttemptRows(pool: Pick<Pool, "query">) {
  const [service, login, tokens, unverified] = await Promise.all([
    pool.query("DELETE FROM service_application_attempts WHERE window_start < now() - interval '1 day'"),
    pool.query("DELETE FROM login_attempts WHERE window_start < now() - interval '1 day'"),
    pool.query("DELETE FROM account_tokens WHERE expires_at < now() - interval '1 day'"),
    pool.query(`DELETE FROM accounts a WHERE a.role='customer' AND a.email_verified_at IS NULL AND a.applied_at < now() - make_interval(days=>$1::int)
      AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.owner_kind='account' AND o.owner_id=a.id::text)`, [UNVERIFIED_KEEP_DAYS]),
  ]);
  return { serviceApplicationAttempts: service.rowCount ?? 0, loginAttempts: login.rowCount ?? 0, accountTokens: tokens.rowCount ?? 0,
    unverifiedAccounts: unverified.rowCount ?? 0 };
}
