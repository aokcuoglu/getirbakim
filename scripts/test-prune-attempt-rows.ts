import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pruneAttemptRows } from "../src/modules/auth/prune-attempts";
import { isolatedSchema } from "./isolated-schema";

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
before(async () => { schema = await isolatedSchema("prune_attempts_test"); });
after(async () => { await schema.drop(); });

test("pruneAttemptRows deletes rows older than a day and keeps recent ones", async () => {
  await schema.pool.query(`INSERT INTO service_application_attempts (key, attempts, window_start) VALUES
    ('signup:global', 3, now() - interval '2 days'), ('signup:ip:recent', 1, now() - interval '23 hours'), ('signup:email:now', 1, now())`);
  await schema.pool.query(`INSERT INTO login_attempts (email, attempts, window_start) VALUES
    ('old@example.invalid', 5, now() - interval '3 days'), ('new@example.invalid', 1, now() - interval '10 minutes')`);
  assert.deepEqual(await pruneAttemptRows(schema.pool), { serviceApplicationAttempts: 1, loginAttempts: 1 });
  const service = await schema.pool.query<{ key: string }>("SELECT key FROM service_application_attempts ORDER BY key");
  const login = await schema.pool.query<{ email: string }>("SELECT email FROM login_attempts");
  assert.deepEqual(service.rows.map(row => row.key), ["signup:email:now", "signup:ip:recent"]);
  assert.deepEqual(login.rows.map(row => row.email), ["new@example.invalid"]);
  assert.deepEqual(await pruneAttemptRows(schema.pool), { serviceApplicationAttempts: 0, loginAttempts: 0 });
});
