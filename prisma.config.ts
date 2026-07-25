import { config as loadEnv } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// Prefer local developer env values; fallback to .env if present.
// quiet: dotenv v17 prints a banner on stdout, which corrupts commands whose
// stdout IS the artifact — `migrate diff --script` writes migration SQL there.
loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  // Use DIRECT_URL for CLI (migrate, studio, etc.). Port 5432 supports prepared statements;
  // port 6543 (PgBouncer) does not → "prepared statement s0 does not exist".
  // App runtime uses DATABASE_URL (pooler) via lib/db / process.env.
  // Fallback to DATABASE_URL if DIRECT_URL is not set (e.g., during Vercel builds)
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || env('DATABASE_URL'),
    // Only set when authoring a migration via scripts/db-migration-new.sh, which
    // points it at a throwaway database. `migrate diff --from-migrations` needs a
    // shadow DB to replay history into; as of Prisma 7 there is no
    // --shadow-database-url flag, so it has to come from here.
    // Never point this at the dev database — the engine drops and recreates
    // everything in it.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {})
  }
})
