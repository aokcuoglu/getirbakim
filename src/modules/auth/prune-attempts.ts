import type { Pool } from "pg";

// Rate-limit rows (#1260): every window is at most an hour, so a row whose window started over a day ago can never
// affect a decision again. Both tables only ever grow otherwise. Account link tokens (#1257) go a day after they expire.
export async function pruneAttemptRows(pool: Pick<Pool, "query">) {
  const [service, login, tokens] = await Promise.all([
    pool.query("DELETE FROM service_application_attempts WHERE window_start < now() - interval '1 day'"),
    pool.query("DELETE FROM login_attempts WHERE window_start < now() - interval '1 day'"),
    pool.query("DELETE FROM account_tokens WHERE expires_at < now() - interval '1 day'"),
  ]);
  return { serviceApplicationAttempts: service.rowCount ?? 0, loginAttempts: login.rowCount ?? 0, accountTokens: tokens.rowCount ?? 0 };
}
