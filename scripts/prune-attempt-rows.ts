// Nightly: deletes expired rate-limit rows (service_application_attempts, login_attempts) older than a day (#1260) and
// account link tokens (account_tokens) a day after they expire (#1257) and customer signups whose e-mail address was
// not verified within 7 days (#1258).
import { Pool } from "pg";
import { pruneAttemptRows } from "../src/modules/auth/prune-attempts";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const deleted = await pruneAttemptRows(pool);
  console.log(`Pruned attempt rows: service_application_attempts ${deleted.serviceApplicationAttempts}, login_attempts ${deleted.loginAttempts}, account_tokens ${deleted.accountTokens}, unverified accounts ${deleted.unverifiedAccounts}`);
} finally { await pool.end(); }
