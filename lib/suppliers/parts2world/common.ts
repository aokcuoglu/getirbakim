import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { db } from '../../db'
import { createAdminClient } from '../../supabase/storage'

const DEFAULT_BASE_URL = 'https://www.parts2world.com'
const DEFAULT_ALLOWED_HOSTS = ['parts2world.com']
const DEFAULT_CHECKPOINT_DIR = '.parts2world-checkpoints'

let adminClient: ReturnType<typeof createAdminClient> | null = null

function getAdminClient() {
  if (!adminClient) {
    adminClient = createAdminClient()
  }
  return adminClient
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item))
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    )

    const normalized: Record<string, unknown> = {}
    for (const [key, item] of entries) {
      normalized[key] = stableValue(item)
    }
    return normalized
  }

  if (typeof value === 'bigint') return value.toString()
  return value
}

function checkpointDir(): string {
  const configured = normalizeText(process.env.PARTS2WORLD_CHECKPOINT_DIR)
  if (!configured) return path.resolve(process.cwd(), DEFAULT_CHECKPOINT_DIR)

  if (path.isAbsolute(configured)) return configured
  return path.resolve(process.cwd(), configured)
}

function sanitizeResumeKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[^a-z0-9-_:.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function checkpointPath(scope: string, resumeKey: string): string {
  const safeScope = sanitizeResumeKey(scope) || 'scope'
  const safeKey = sanitizeResumeKey(resumeKey) || 'default'
  return path.join(checkpointDir(), `${safeScope}-${safeKey}.json`)
}

export function parseArgValue(name: string): string | null {
  const full = `--${name}=`
  const short = `${name}=`
  const arg = process.argv.find(
    (item) => item.startsWith(full) || item.startsWith(short)
  )
  if (!arg) return null
  return arg.startsWith(full) ? arg.slice(full.length) : arg.slice(short.length)
}

export function buildResumeKey(
  scope: string,
  payload: Record<string, unknown>
): string {
  const normalizedScope = sanitizeResumeKey(scope) || 'scope'
  const normalizedPayload = stableValue(payload)
  const digest = createHash('sha1')
    .update(JSON.stringify(normalizedPayload))
    .digest('hex')
    .slice(0, 12)
  return `${normalizedScope}-${digest}`
}

export async function readCheckpoint<T>(
  scope: string,
  resumeKey: string
): Promise<T | null> {
  const filePath = checkpointPath(scope, resumeKey)
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }

    const message =
      error instanceof Error
        ? error.message.toLocaleLowerCase('tr')
        : String(error)
    if (message.includes('no such file')) return null
    throw error
  }
}

export async function writeCheckpoint<T>(
  scope: string,
  resumeKey: string,
  payload: T
): Promise<void> {
  const filePath = checkpointPath(scope, resumeKey)
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })

  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tempPath, filePath)
}

export async function deleteCheckpoint(
  scope: string,
  resumeKey: string
): Promise<void> {
  const filePath = checkpointPath(scope, resumeKey)
  await rm(filePath, { force: true })
}

export function parseBoolean(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLocaleLowerCase('tr')
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function parsePositiveInt(
  value: string | null | undefined
): number | null {
  if (value == null) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const intValue = Math.trunc(num)
  return intValue > 0 ? intValue : null
}

export function parsePositiveBigInt(value: unknown): bigint | null {
  if (value == null) return null
  if (typeof value === 'bigint') return value > BigInt(0) ? value : null

  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null

  try {
    const parsed = BigInt(text)
    return parsed > BigInt(0) ? parsed : null
  } catch {
    return null
  }
}

export function parseIntList(value: string | null | undefined): number[] {
  if (!value) return []

  return unique(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))
}

export function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export function normalizeTextList(values: unknown[]): string[] {
  const set = new Set<string>()
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) set.add(normalized)
  }
  return Array.from(set)
}

export function getParts2WorldBaseUrls(): string[] {
  const configured = normalizeText(process.env.PARTS2WORLD_BASE_URL)
  const extra = normalizeText(process.env.PARTS2WORLD_FALLBACK_BASE_URLS)

  const values = [configured, DEFAULT_BASE_URL]
  if (extra) {
    values.push(
      ...extra
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  }

  return unique(values.filter(Boolean).map((item) => normalizeBaseUrl(item!)))
}

export function getParts2WorldAllowedHosts(): string[] {
  const configured = normalizeText(process.env.PARTS2WORLD_ALLOWED_HOSTS)
  if (!configured) return DEFAULT_ALLOWED_HOSTS

  const hosts = configured
    .split(',')
    .map((item) => item.trim().toLocaleLowerCase('tr'))
    .filter(Boolean)

  return hosts.length > 0 ? unique(hosts) : DEFAULT_ALLOWED_HOSTS
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isProtocolRelativeUrl(value: string): boolean {
  return /^\/\//.test(value)
}

export function buildUrlCandidates(input: {
  rawUrl?: string | null
  docId?: string | null
  baseUrls: string[]
}): string[] {
  const rawUrl = normalizeText(input.rawUrl)
  const docId = normalizeText(input.docId)

  if (!rawUrl && docId) {
    return input.baseUrls.map(
      (baseUrl) => `${baseUrl}/tecdoc/documents/${docId}/`
    )
  }

  if (!rawUrl) return []

  if (isAbsoluteUrl(rawUrl)) {
    return [rawUrl]
  }

  if (isProtocolRelativeUrl(rawUrl)) {
    return [`https:${rawUrl}`]
  }

  const normalizedPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  return input.baseUrls.map((baseUrl) => `${baseUrl}${normalizedPath}`)
}

export function isSupabasePublicUrl(value: string): boolean {
  return /\/storage\/v1\/object\/public\//.test(value)
}

function hostMatchesAllowedHosts(
  urlValue: string,
  allowedHosts: string[]
): boolean {
  try {
    const host = new URL(urlValue).hostname.toLocaleLowerCase('tr')
    return allowedHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    )
  } catch {
    return false
  }
}

export function shouldUploadToSupabase(
  urlCandidates: string[],
  allowedHosts: string[]
): boolean {
  if (urlCandidates.length === 0) return false
  if (urlCandidates.some((candidate) => isSupabasePublicUrl(candidate)))
    return false

  return urlCandidates.some((candidate) =>
    hostMatchesAllowedHosts(candidate, allowedHosts)
  )
}

function sanitizeFileName(value: string): string {
  const normalized = value
    .replace(/\.[^.]*$/, '')
    .toLocaleLowerCase('tr')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || 'file'
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return ''
  const normalized = contentType.toLocaleLowerCase('tr')
  if (normalized.includes('jpeg')) return '.jpg'
  if (normalized.includes('jpg')) return '.jpg'
  if (normalized.includes('png')) return '.png'
  if (normalized.includes('webp')) return '.webp'
  if (normalized.includes('gif')) return '.gif'
  if (normalized.includes('svg')) return '.svg'
  if (normalized.includes('pdf')) return '.pdf'
  if (normalized.includes('json')) return '.json'
  if (normalized.includes('plain')) return '.txt'
  return ''
}

function extensionFromFileName(value: string | null | undefined): string {
  if (!value) return ''
  const match = value.match(/\.([a-zA-Z0-9]{1,8})(?:$|\?)/)
  if (!match) return ''
  return `.${match[1].toLocaleLowerCase('tr')}`
}

function buildStoragePath(input: {
  prefix: string
  cacheKey: string
  sourceUrl: string
  fallbackFileName?: string | null
  contentType: string | null
}): string {
  const hash = createHash('sha1')
    .update(input.cacheKey)
    .digest('hex')
    .slice(0, 20)
  const safePrefix = input.prefix.replace(/^\/+|\/+$/g, '')
  const safeName = sanitizeFileName(input.fallbackFileName || 'asset')

  const ext =
    extensionFromFileName(input.fallbackFileName) ||
    extensionFromFileName(input.sourceUrl) ||
    extensionFromContentType(input.contentType) ||
    '.bin'

  return `${safePrefix}/${safeName}-${hash}${ext}`
}

export async function ensureStorageBucket(
  bucket: string,
  isPublic: boolean = true
): Promise<void> {
  const supabase = getAdminClient()
  const { data, error } = await supabase.storage.listBuckets()
  if (error) {
    throw new Error(`Bucket list failed for ${bucket}: ${error.message}`)
  }

  if (data.some((item) => item.name === bucket)) return

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: isPublic
  })

  if (
    createError &&
    !createError.message.toLocaleLowerCase('tr').includes('already exists')
  ) {
    throw new Error(
      `Bucket create failed for ${bucket}: ${createError.message}`
    )
  }
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRetryableError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLocaleLowerCase('tr')
      : String(error)
  return (
    message.includes('timeout') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('connection reset') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('connection closed') ||
    message.includes('temporarily unavailable') ||
    message.includes('too many requests') ||
    message.includes('deadlock') ||
    message.includes('rate limit')
  )
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3
): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await operation()
    } catch (error) {
      attempt += 1
      if (attempt > retries || !isRetryableError(error)) {
        throw error
      }

      await sleep(250 * attempt)
    }
  }
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  if (items.length === 0) return

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })

  await Promise.all(workers)
}

type UploadFromCandidatesInput = {
  bucket: string
  storagePrefix: string
  urlCandidates: string[]
  cacheKey: string
  fallbackFileName?: string | null
  cache: Map<string, string>
}

export async function uploadFromUrlCandidates(
  input: UploadFromCandidatesInput
): Promise<string | null> {
  if (input.urlCandidates.length === 0) return null

  const cached = input.cache.get(input.cacheKey)
  if (cached) return cached

  const supabase = getAdminClient()
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Referer: input.urlCandidates[0]
  }

  for (const candidateUrl of input.urlCandidates) {
    try {
      const response = await withRetry(
        () => fetch(candidateUrl, { headers }),
        2
      )
      if (!response.ok) {
        continue
      }

      const contentType = response.headers.get('content-type')
      const arrayBuffer = await response.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      if (buffer.length === 0) continue

      const storagePath = buildStoragePath({
        prefix: input.storagePrefix,
        cacheKey: input.cacheKey,
        sourceUrl: candidateUrl,
        fallbackFileName: input.fallbackFileName,
        contentType
      })

      const { error: uploadError } = await supabase.storage
        .from(input.bucket)
        .upload(storagePath, buffer, {
          contentType: contentType || 'application/octet-stream',
          upsert: true
        })

      if (uploadError) {
        continue
      }

      const {
        data: { publicUrl }
      } = supabase.storage.from(input.bucket).getPublicUrl(storagePath)

      input.cache.set(input.cacheKey, publicUrl)
      return publicUrl
    } catch {
      continue
    }
  }

  return null
}

export type SyncRunStatus = 'running' | 'completed' | 'failed' | 'stopped'

export type SyncRunCounters = {
  processed: number
  created: number
  updated: number
  failed: number
  skipped: number
}

type DbCheckpointRow = {
  id: bigint
  script_name: string
  resume_key: string
  run_id: bigint | null
  cursor: string | null
  payload: unknown
  updated_at: Date
}

let syncInfraReady = false

async function syncInfraExists(): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<
    Array<{
      runs_exists: boolean
      checkpoints_exists: boolean
      errors_exists: boolean
    }>
  >(
    `
      SELECT
        to_regclass('public.parts2world_sync_runs') IS NOT NULL AS runs_exists,
        to_regclass('public.parts2world_sync_checkpoints') IS NOT NULL AS checkpoints_exists,
        to_regclass('public.parts2world_sync_errors') IS NOT NULL AS errors_exists
    `
  )

  const row = rows[0]
  return Boolean(
    row?.runs_exists && row?.checkpoints_exists && row?.errors_exists
  )
}

export async function ensureSyncInfra(): Promise<void> {
  if (syncInfraReady) return

  if (await syncInfraExists()) {
    syncInfraReady = true
    return
  }

  const lockKey = 904631137
  let lockAcquired = false

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await db.$queryRawUnsafe<Array<{ locked: boolean }>>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      lockKey
    )

    if (rows[0]?.locked) {
      lockAcquired = true
      break
    }

    if (await syncInfraExists()) {
      syncInfraReady = true
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  if (!lockAcquired) {
    throw new Error(
      'parts2world sync infra lock could not be acquired; another session may be holding it'
    )
  }

  try {
    if (await syncInfraExists()) {
      syncInfraReady = true
      return
    }

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.parts2world_sync_runs (
        id BIGSERIAL PRIMARY KEY,
        script_name TEXT NOT NULL,
        status TEXT NOT NULL,
        resume_key TEXT,
        args_json JSONB,
        host TEXT,
        pid INTEGER,
        started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP(6),
        processed INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        checkpoint_cursor TEXT,
        checkpoint_payload JSONB
      )
    `)

    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_parts2world_sync_runs_script_name_started_at ON public.parts2world_sync_runs(script_name, started_at)'
    )
    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_parts2world_sync_runs_status_started_at ON public.parts2world_sync_runs(status, started_at)'
    )

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.parts2world_sync_checkpoints (
        id BIGSERIAL PRIMARY KEY,
        script_name TEXT NOT NULL,
        resume_key TEXT NOT NULL,
        run_id BIGINT,
        cursor TEXT,
        payload JSONB,
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT parts2world_sync_checkpoints_script_name_resume_key_key
          UNIQUE (script_name, resume_key),
        CONSTRAINT parts2world_sync_checkpoints_run_id_fkey
          FOREIGN KEY (run_id)
          REFERENCES public.parts2world_sync_runs(id)
          ON DELETE SET NULL
          ON UPDATE NO ACTION
      )
    `)
    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_parts2world_sync_checkpoints_run_id ON public.parts2world_sync_checkpoints(run_id)'
    )

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.parts2world_sync_errors (
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL,
        script_name TEXT NOT NULL,
        stage TEXT,
        entity_type TEXT,
        entity_id TEXT,
        request_url TEXT,
        message TEXT NOT NULL,
        context JSONB,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT parts2world_sync_errors_run_id_fkey
          FOREIGN KEY (run_id)
          REFERENCES public.parts2world_sync_runs(id)
          ON DELETE CASCADE
          ON UPDATE NO ACTION
      )
    `)
    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_parts2world_sync_errors_run_id_created_at ON public.parts2world_sync_errors(run_id, created_at)'
    )
    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_parts2world_sync_errors_script_name_created_at ON public.parts2world_sync_errors(script_name, created_at)'
    )
  } finally {
    if (lockAcquired) {
      await db.$executeRawUnsafe('SELECT pg_advisory_unlock($1)', lockKey)
    }
  }

  syncInfraReady = true
}

export async function startSyncRun(input: {
  scriptName: string
  resumeKey: string | null
  args?: Record<string, unknown>
}): Promise<bigint> {
  await ensureSyncInfra()
  const rows = await db.$queryRawUnsafe<Array<{ id: bigint }>>(
    `
      INSERT INTO public.parts2world_sync_runs (
        script_name,
        status,
        resume_key,
        args_json,
        host,
        pid
      )
      VALUES ($1, 'running', $2, $3::jsonb, $4, $5)
      RETURNING id
    `,
    input.scriptName,
    input.resumeKey,
    JSON.stringify(input.args || {}),
    os.hostname(),
    process.pid
  )
  return rows[0]?.id || BigInt(0)
}

export async function updateSyncRun(input: {
  runId: bigint
  status?: SyncRunStatus
  counters?: Partial<SyncRunCounters>
  checkpointCursor?: string | null
  checkpointPayload?: unknown
  finished?: boolean
}): Promise<void> {
  await ensureSyncInfra()
  const counters = input.counters || {}
  await db.$executeRawUnsafe(
    `
      UPDATE public.parts2world_sync_runs
      SET
        status = COALESCE($2, status),
        processed = COALESCE($3, processed),
        created = COALESCE($4, created),
        updated = COALESCE($5, updated),
        failed = COALESCE($6, failed),
        skipped = COALESCE($7, skipped),
        checkpoint_cursor = CASE WHEN $8::boolean THEN $9 ELSE checkpoint_cursor END,
        checkpoint_payload = CASE WHEN $10::boolean THEN $11::jsonb ELSE checkpoint_payload END,
        finished_at = CASE WHEN $12::boolean THEN CURRENT_TIMESTAMP ELSE finished_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    input.runId,
    input.status || null,
    typeof counters.processed === 'number' ? counters.processed : null,
    typeof counters.created === 'number' ? counters.created : null,
    typeof counters.updated === 'number' ? counters.updated : null,
    typeof counters.failed === 'number' ? counters.failed : null,
    typeof counters.skipped === 'number' ? counters.skipped : null,
    input.checkpointCursor !== undefined,
    input.checkpointCursor || null,
    input.checkpointPayload !== undefined,
    input.checkpointPayload === undefined
      ? null
      : JSON.stringify(input.checkpointPayload),
    Boolean(input.finished)
  )
}

export async function readDbCheckpoint<T>(
  scriptName: string,
  resumeKey: string
): Promise<{ runId: bigint | null; cursor: string | null; payload: T | null } | null> {
  await ensureSyncInfra()
  const rows = await db.$queryRawUnsafe<Array<{ run_id: bigint | null; cursor: string | null; payload: unknown }>>(
    `
      SELECT run_id, cursor, payload
      FROM public.parts2world_sync_checkpoints
      WHERE script_name = $1 AND resume_key = $2
      LIMIT 1
    `,
    scriptName,
    resumeKey
  )
  const row = rows[0]

  if (!row) return null
  return {
    runId: row.run_id,
    cursor: row.cursor,
    payload: (row.payload as T | null) || null
  }
}

export async function writeDbCheckpoint<T>(input: {
  scriptName: string
  resumeKey: string
  runId: bigint
  cursor: string | null
  payload: T
}): Promise<void> {
  await ensureSyncInfra()
  await db.$executeRawUnsafe(
    `
      INSERT INTO public.parts2world_sync_checkpoints (
        script_name,
        resume_key,
        run_id,
        cursor,
        payload,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (script_name, resume_key)
      DO UPDATE SET
        run_id = EXCLUDED.run_id,
        cursor = EXCLUDED.cursor,
        payload = EXCLUDED.payload,
        updated_at = CURRENT_TIMESTAMP
    `,
    input.scriptName,
    input.resumeKey,
    input.runId,
    input.cursor,
    JSON.stringify(input.payload)
  )
}

export async function deleteDbCheckpoint(
  scriptName: string,
  resumeKey: string
): Promise<void> {
  await ensureSyncInfra()
  await db.$executeRawUnsafe(
    'DELETE FROM public.parts2world_sync_checkpoints WHERE script_name = $1 AND resume_key = $2',
    scriptName,
    resumeKey
  )
}

export async function appendSyncError(input: {
  runId: bigint
  scriptName: string
  message: string
  stage?: string | null
  entityType?: string | null
  entityId?: string | null
  requestUrl?: string | null
  context?: unknown
}): Promise<void> {
  await ensureSyncInfra()
  await db.$executeRawUnsafe(
    `
      INSERT INTO public.parts2world_sync_errors (
        run_id,
        script_name,
        stage,
        entity_type,
        entity_id,
        request_url,
        message,
        context
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    input.runId,
    input.scriptName,
    input.stage || null,
    input.entityType || null,
    input.entityId || null,
    input.requestUrl || null,
    input.message,
    input.context == null ? null : JSON.stringify(input.context)
  )
}
