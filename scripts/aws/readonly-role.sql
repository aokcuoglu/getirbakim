-- -----------------------------------------------------------------------------
-- GetirBakim production: read-only login role for the DB tunnel (#940).
--
-- Not part of db/ on purpose: deploy-time db:setup must not run it. It is run
-- by hand through the write-capable tunnel (docs/aws-db-tunnel.md).
--
-- Creates `getirbakim_readonly` (LOGIN) if missing and (re)sets its password,
-- grants CONNECT / USAGE ON SCHEMA public / SELECT on every table, view and
-- sequence, and adds default privileges so tables the app role creates later
-- are readable too. `default_transaction_read_only = on` is a second guard;
-- the real guard is the missing INSERT/UPDATE/DELETE/TRUNCATE privilege.
-- statement_timeout 5min, idle_in_transaction_session_timeout 10min and
-- CONNECTION LIMIT 5 bound what a forgotten session can hold. Advisory locks
-- (pg_advisory_lock, executable by PUBLIC) stay available to the role and
-- cannot be revoked for it alone: never take them as getirbakim_readonly,
-- scripts/setup.ts serializes deploys on pg_advisory_xact_lock(20261001, n).
-- Idempotent: running it again re-applies the grants and rotates the password.
--
-- Who runs it (RDS has no superuser):
--   * the app role (getirbakim_app) when it has CREATEROLE, or
--   * the RDS master user (rds_superuser, has CREATEROLE). The table grants and
--     default privileges are then made as the app role (SET ROLE), so the
--     master must be a member of it: GRANT getirbakim_app TO <master>;
--   Check: SELECT rolname, rolcreaterole, rolsuper FROM pg_roles
--          WHERE rolname IN (current_user, 'getirbakim_app');
--   On PostgreSQL 16+ only the role that created getirbakim_readonly (or a
--   superuser) may change it, so re-run with the same user.
--
-- The password never reaches the server: it is read from the macOS Keychain
-- inside psql and turned into a SCRAM-SHA-256 verifier on this machine
-- (scripts/aws/scram-verifier.mjs). Only the verifier is sent, so server logs,
-- pg_stat_statements and error reports cannot contain the plaintext. Nothing is
-- passed on the command line.
--
-- Usage, from the repository root (needs `security` and Node.js):
--   security add-generic-password -U -a getirbakim_readonly -s getirbakim-prod-readonly \
--     -w "$(openssl rand -base64 32 | tr -d '/+=')"
--   psql "<write DSN>" -f scripts/aws/readonly-role.sql
-- Optional: -v app_role=<role that owns the tables> (default getirbakim_app).
-- -----------------------------------------------------------------------------
\set ON_ERROR_STOP 1
\set QUIET 1
\pset footer off

\if :{?app_role}
\else
  \set app_role getirbakim_app
\endif

-- 1. Password -> verifier, client side. psql does not stop when a backtick
--    command fails, so the result is checked (again without argv) before use.
\set ro_verifier `security find-generic-password -s getirbakim-prod-readonly -w | node scripts/aws/scram-verifier.mjs`
\setenv GETIRBAKIM_RO_VERIFIER :ro_verifier
\set verifier_ok `node scripts/aws/scram-verifier.mjs --check`
\setenv GETIRBAKIM_RO_VERIFIER
\if :verifier_ok
\else
  \echo 'ERR: no usable password in the Keychain item getirbakim-prod-readonly (see the header of this file)'
  DO $$ BEGIN RAISE EXCEPTION 'read-only password missing'; END $$;
\endif

-- 2. Preflight: who am I, can I create roles, may I act as the app role?
SELECT current_user AS runner,
       current_database() AS database,
       r.rolsuper OR r.rolcreaterole AS can_create_role,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'getirbakim_readonly') AS role_exists,
       current_user = :'app_role' OR CASE WHEN current_setting('server_version_num')::int >= 160000
         THEN pg_has_role(current_user, a.oid, 'SET') ELSE pg_has_role(current_user, a.oid, 'MEMBER') END AS can_act_as_app,
       a.oid IS NOT NULL AS app_role_exists,
       has_database_privilege(current_database(), 'CONNECT WITH GRANT OPTION') AS can_grant_connect,
       has_schema_privilege('public', 'USAGE WITH GRANT OPTION') AS can_grant_usage,
       current_setting('log_statement') AS log_statement,
       current_setting('log_min_duration_statement') AS log_min_duration_statement
FROM pg_roles r
LEFT JOIN pg_roles a ON a.rolname = :'app_role'
WHERE r.rolname = current_user \gset

\echo 'runner:' :runner ' database:' :database ' app role:' :app_role
\echo 'log_statement:' :log_statement ' log_min_duration_statement:' :log_min_duration_statement '(only the verifier can appear in logs)'
\if :app_role_exists
\else
  \echo 'ERR: app role' :app_role 'does not exist; pass the owner of the tables with -v app_role=...'
  DO $$ BEGIN RAISE EXCEPTION 'app role not found'; END $$;
\endif
\if :can_create_role
\else
  \echo 'ERR:' :runner 'has no CREATEROLE (rolcreaterole = false). Run this file as the RDS master user.'
  DO $$ BEGIN RAISE EXCEPTION 'CREATEROLE required'; END $$;
\endif
\if :can_act_as_app
\else
  \echo 'ERR:' :runner 'is not a member of' :app_role '. As the RDS master run first:'
  \echo '     GRANT' :app_role 'TO' :runner ';'
  DO $$ BEGIN RAISE EXCEPTION 'membership in the app role required'; END $$;
\endif

BEGIN;

-- 3. The role and its password (a SCRAM verifier, stored as is). Session
--    limits keep a forgotten psql from holding locks or a connection slot.
SELECT 'CREATE ROLE getirbakim_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT :'role_exists'::boolean \gexec
SELECT format('ALTER ROLE getirbakim_readonly LOGIN CONNECTION LIMIT 5 PASSWORD %L', :'ro_verifier') \gexec
ALTER ROLE getirbakim_readonly SET default_transaction_read_only = on;
ALTER ROLE getirbakim_readonly SET statement_timeout = '5min';
ALTER ROLE getirbakim_readonly SET idle_in_transaction_session_timeout = '10min';

-- 4. Database and schema. Both are granted to PUBLIC by default; when the runner
--    may not grant them the PUBLIC grant must already be in place.
\if :can_grant_connect
  SELECT format('GRANT CONNECT ON DATABASE %I TO getirbakim_readonly', current_database()) \gexec
\endif
\if :can_grant_usage
  GRANT USAGE ON SCHEMA public TO getirbakim_readonly;
\endif
SELECT has_database_privilege('getirbakim_readonly', current_database(), 'CONNECT') AS ro_connect,
       has_schema_privilege('getirbakim_readonly', 'public', 'USAGE') AS ro_usage \gset
\if :ro_connect
\else
  \echo 'ERR: getirbakim_readonly cannot connect and' :runner 'may not grant CONNECT. Run as the database owner.'
  DO $$ BEGIN RAISE EXCEPTION 'CONNECT missing'; END $$;
\endif
\if :ro_usage
\else
  \echo 'ERR: getirbakim_readonly has no USAGE on schema public and' :runner 'may not grant it.'
  DO $$ BEGIN RAISE EXCEPTION 'USAGE missing'; END $$;
\endif

-- 5. Tables, views, materialized views and sequences, now and later. Made as
--    the app role so the grantor is the owner of the objects.
SET LOCAL ROLE :"app_role";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO getirbakim_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO getirbakim_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_role" IN SCHEMA public GRANT SELECT ON TABLES TO getirbakim_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE :"app_role" IN SCHEMA public GRANT SELECT ON SEQUENCES TO getirbakim_readonly;
RESET ROLE;

COMMIT;

-- 6. Verification. Expected: login t, connection_limit 5, the three settings,
--    every count 0 except readable_tables, and default ACLs listing r (tables)
--    and S (sequences).
\echo
\echo 'Role:'
SELECT r.rolname, r.rolcanlogin AS login, r.rolsuper AS superuser, r.rolcreaterole AS createrole,
       r.rolcreatedb AS createdb, r.rolconnlimit AS connection_limit, s.setconfig AS settings
FROM pg_roles r
LEFT JOIN pg_db_role_setting s ON s.setrole = r.oid AND s.setdatabase = 0
WHERE r.rolname = 'getirbakim_readonly';

\echo 'Privileges in schema public:'
SELECT count(*) FILTER (WHERE has_table_privilege('getirbakim_readonly', c.oid, 'SELECT')) AS readable_tables,
       count(*) FILTER (WHERE NOT has_table_privilege('getirbakim_readonly', c.oid, 'SELECT')) AS unreadable_tables,
       count(*) FILTER (WHERE has_table_privilege('getirbakim_readonly', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS writable_tables,
       count(*) FILTER (WHERE c.relowner = 'getirbakim_readonly'::regrole) AS owned_by_readonly
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S');

SELECT has_database_privilege('getirbakim_readonly', current_database(), 'CONNECT') AS can_connect,
       has_schema_privilege('getirbakim_readonly', 'public', 'USAGE') AS schema_usage,
       has_schema_privilege('getirbakim_readonly', 'public', 'CREATE') AS schema_create;

\echo 'Default privileges (future tables):'
SELECT pg_get_userbyid(d.defaclrole) AS for_role, d.defaclobjtype AS object_type, d.defaclacl AS acl
FROM pg_default_acl d
WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclacl::text LIKE '%getirbakim_readonly%';

\echo 'schema_create = t: PUBLIC may still create in schema public (PostgreSQL < 15);'
\echo 'default_transaction_read_only blocks it unless the session turns the setting off.'
