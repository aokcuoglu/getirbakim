import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pruneAttemptRows } from "../src/modules/auth/prune-attempts";
import { isolatedSchema } from "./isolated-schema";

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
before(async () => { schema = await isolatedSchema("prune_attempts_test"); });
after(async () => { await schema.drop(); });

test("pruneAttemptRows deletes rows older than a day and keeps recent ones", async () => {
  const account = (await schema.pool.query<{ id: string }>("INSERT INTO accounts (name,email,password_hash,role,approved) VALUES ('Ayşe','prune@example.invalid','x','customer',true) RETURNING id")).rows[0].id;
  await schema.pool.query(`INSERT INTO account_tokens (token_hash, account_id, purpose, expires_at) VALUES
    ('old', $1, 'password_reset', now() - interval '2 days'), ('expired-today', $1, 'password_reset', now() - interval '1 hour'),
    ('live', $1, 'email_verification', now() + interval '1 hour')`, [account]);
  await schema.pool.query(`INSERT INTO service_application_attempts (key, attempts, window_start) VALUES
    ('signup:global', 3, now() - interval '2 days'), ('signup:ip:recent', 1, now() - interval '23 hours'), ('signup:email:now', 1, now())`);
  await schema.pool.query(`INSERT INTO login_attempts (email, attempts, window_start) VALUES
    ('old@example.invalid', 5, now() - interval '3 days'), ('new@example.invalid', 1, now() - interval '10 minutes')`);
  assert.deepEqual(await pruneAttemptRows(schema.pool), { serviceApplicationAttempts: 1, loginAttempts: 1, accountTokens: 1, unverifiedAccounts: 0 });
  const service = await schema.pool.query<{ key: string }>("SELECT key FROM service_application_attempts ORDER BY key");
  const login = await schema.pool.query<{ email: string }>("SELECT email FROM login_attempts");
  assert.deepEqual(service.rows.map(row => row.key), ["signup:email:now", "signup:ip:recent"]);
  assert.deepEqual(login.rows.map(row => row.email), ["new@example.invalid"]);
  const tokens = await schema.pool.query<{ token_hash: string }>("SELECT token_hash FROM account_tokens ORDER BY token_hash");
  assert.deepEqual(tokens.rows.map(row => row.token_hash), ["expired-today", "live"]);
  assert.deepEqual(await pruneAttemptRows(schema.pool), { serviceApplicationAttempts: 0, loginAttempts: 0, accountTokens: 0, unverifiedAccounts: 0 });
});

test("pruneAttemptRows deletes customer signups unverified for over 7 days, with their acceptance and tokens, unless they have an order (#1258)", async () => {
  const create = async (email: string, days: number, verified: boolean, role = "customer") => (await schema.pool.query<{ id: string }>(
    `INSERT INTO accounts (name,email,password_hash,role,approved,applied_at,email_verified_at)
     VALUES ('Ayşe',$1,'x',$2,true,now()-make_interval(days=>$3::int),CASE WHEN $4::boolean THEN now() END) RETURNING id`, [email, role, days, verified])).rows[0].id;
  const stale = await create("stale@example.invalid", 8, false);
  await create("recent@example.invalid", 6, false);
  await create("verified-old@example.invalid", 30, true);
  const ordered = await create("ordered@example.invalid", 8, false);
  await create("service-old@example.invalid", 30, false, "service");
  await schema.pool.query(`INSERT INTO account_term_acceptances (account_id,document,terms_version,privacy_notice_version,consent_text)
    VALUES ($1,'uyelik-ve-kullanim-kosullari','v','v','metin')`, [stale]);
  await schema.pool.query("INSERT INTO account_tokens (token_hash,account_id,purpose,expires_at) VALUES ('stale-link',$1,'email_verification',now()+interval '1 hour')", [stale]);
  await schema.pool.query(`INSERT INTO commerce_orders (owner_kind,owner_id,request_key,customer_name,email,phone,address,total_kurus,subtotal_kurus,discount_percent)
    VALUES ('account',$1,gen_random_uuid(),'Ayşe','ordered@example.invalid','05550000000','Adres',10000,10000,0)`, [ordered]);
  assert.equal((await pruneAttemptRows(schema.pool)).unverifiedAccounts, 1);
  const left = await schema.pool.query<{ email: string }>("SELECT email FROM accounts WHERE email LIKE '%@example.invalid' AND email<>'prune@example.invalid' ORDER BY email");
  assert.deepEqual(left.rows.map(row => row.email), ["ordered@example.invalid", "recent@example.invalid", "service-old@example.invalid", "verified-old@example.invalid"]);
  assert.equal((await schema.pool.query("SELECT 1 FROM account_term_acceptances WHERE account_id=$1", [stale])).rowCount, 0);
  assert.equal((await schema.pool.query("SELECT 1 FROM account_tokens WHERE account_id=$1", [stale])).rowCount, 0);
});
