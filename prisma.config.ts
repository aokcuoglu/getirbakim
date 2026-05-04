import { config as loadEnv } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// Prefer local developer env values; fallback to .env if present.
loadEnv({ path: '.env.local' })
loadEnv()

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
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || env('DATABASE_URL')
  }
})
