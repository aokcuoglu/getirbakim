import type { Pool } from "pg";

// Rate-limit rows (#1260): every window is at most an hour, so a row whose window started over a day ago can never
// affect a decision again. Both tables only ever grow otherwise.
export async function pruneAttemptRows(pool: Pick<Pool, "query">) {
  const [service, login] = await Promise.all([
    pool.query("DELETE FROM service_application_attempts WHERE window_start < now() - interval '1 day'"),
    pool.query("DELETE FROM login_attempts WHERE window_start < now() - interval '1 day'"),
  ]);
  return { serviceApplicationAttempts: service.rowCount ?? 0, loginAttempts: login.rowCount ?? 0 };
}
