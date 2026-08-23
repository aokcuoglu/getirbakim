/** Generate or consume an immutable REPXPERT OEM apply manifest. */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

const SOURCE_SITE = 'repxpert.com.tr'
const REVIEWER = 'bulk-apply-repxpert-oem'
const args = process.argv.slice(2)
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

interface DbRow { id: bigint; product_id: bigint; value: string; value_norm: string; oem_brand: string }
interface CountRow { count: bigint }
interface MaxRow { max_id: bigint | null }
interface Payload { suggestion_id: string; product_id: string; code: string; code_norm: string; oem_brand: string }
interface Manifest {
  version: 2; source_site: 'repxpert.com.tr'; kind: 'OEM'; initial_status: 'PENDING'; cutoff_id: string
  selected_count: number; newly_insertable_count: number; selected: Payload[]; newly_insertable: Payload[]
}

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const payload = (row: DbRow): Payload => ({ suggestion_id: row.id.toString(), product_id: row.product_id.toString(), code: row.value, code_norm: row.value_norm, oem_brand: row.oem_brand })
const finalKey = (row: Payload) => `${row.product_id}\0${row.code_norm}\0${row.oem_brand}`

function validateManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object') throw new Error('Manifest nesne değil')
  const m = value as Manifest
  if (m.version !== 2 || m.source_site !== SOURCE_SITE || m.kind !== 'OEM' || m.initial_status !== 'PENDING') throw new Error('Manifest metadata geçersiz')
  if (!/^\d+$/.test(m.cutoff_id) || !Array.isArray(m.selected) || !Array.isArray(m.newly_insertable)) throw new Error('Manifest yapısı geçersiz')
  if (m.selected_count !== m.selected.length || m.newly_insertable_count !== m.newly_insertable.length) throw new Error('Manifest count alanları uyuşmuyor')
  const cutoff = BigInt(m.cutoff_id)
  const ids = m.selected.map((row) => BigInt(row.suggestion_id))
  if (ids.some((id, i) => id > cutoff || (i > 0 && id <= ids[i - 1]))) throw new Error('Selected ID listesi unique/sıralı değil veya cutoff dışında')
  const selectedIds = new Set(m.selected.map((row) => row.suggestion_id))
  const selectedById = new Map(m.selected.map((row) => [row.suggestion_id, row]))
  const insertIds = m.newly_insertable.map((row) => BigInt(row.suggestion_id))
  if (insertIds.some((id, i) => i > 0 && id <= insertIds[i - 1])) throw new Error('Insert ID listesi unique/sıralı değil')
  if (m.newly_insertable.some((row) => !selectedIds.has(row.suggestion_id))) throw new Error('Insert satırı selected kümesi dışında')
  if (m.newly_insertable.some((row) => JSON.stringify(row) !== JSON.stringify(selectedById.get(row.suggestion_id)))) throw new Error('Insert payloadı selected payloadıyla uyuşmuyor')
  if (new Set(m.newly_insertable.map(finalKey)).size !== m.newly_insertable.length) throw new Error('Yeni final key listesi unique değil')
  for (const row of m.selected) {
    if (!/^\d+$/.test(row.suggestion_id) || !/^\d+$/.test(row.product_id) || typeof row.code !== 'string' || typeof row.code_norm !== 'string' || typeof row.oem_brand !== 'string') throw new Error(`Geçersiz payload: ${String(row.suggestion_id)}`)
  }
  return m
}

async function readManifest(path: string) {
  const absolute = resolve(path); const bytes = await readFile(absolute)
  return { manifest: validateManifest(JSON.parse(bytes.toString('utf8'))), sha256: hash(bytes), path: absolute }
}

function requireExpectedSha(actual: string): void {
  const expected = option('expected-sha256')
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('--expected-sha256=<64 hex> zorunlu')
  if (expected.toLowerCase() !== actual) throw new Error(`Manifest SHA-256 uyuşmuyor: gerçek ${actual}`)
}

async function durableExclusive(path: string, value: unknown): Promise<void> {
  const handle = await open(path, 'wx')
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync() } finally { await handle.close() }
}

function assertLockedRows(manifest: Manifest, locked: DbRow[]): void {
  if (locked.length !== manifest.selected.length) throw new Error('Kilitlenen satır sayısı manifestle uyuşmuyor')
  for (let i = 0; i < locked.length; i += 1) {
    if (JSON.stringify(payload(locked[i])) !== JSON.stringify(manifest.selected[i])) throw new Error(`DB payloadı değişti: suggestion ${manifest.selected[i].suggestion_id}`)
  }
}

async function generate(): Promise<void> {
  const max = await db.$queryRaw<MaxRow[]>`select max(id) as max_id from catalog.product_ref_suggestions where source_site=${SOURCE_SITE} and kind='OEM' and status='PENDING'`
  const cutoff = max[0]?.max_id
  if (cutoff == null) { console.log('Bekleyen REPXPERT OEM önerisi yok.'); return }
  const selected = await db.$queryRaw<DbRow[]>`select id, product_id, value, value_norm, oem_brand from catalog.product_ref_suggestions where id<=${cutoff} and source_site=${SOURCE_SITE} and kind='OEM' and status='PENDING' order by id`
  const insertable = await db.$queryRaw<DbRow[]>`
    select s.id, s.product_id, s.value, s.value_norm, s.oem_brand from catalog.product_ref_suggestions s
    where s.id<=${cutoff} and s.source_site=${SOURCE_SITE} and s.kind='OEM' and s.status='PENDING'
      and not exists (select 1 from catalog.product_oems o where o.product_id=s.product_id and o.code_norm=s.value_norm and o.oem_brand=s.oem_brand) order by s.id`
  const manifest: Manifest = { version: 2, source_site: SOURCE_SITE, kind: 'OEM', initial_status: 'PENDING', cutoff_id: cutoff.toString(), selected_count: selected.length, newly_insertable_count: insertable.length, selected: selected.map(payload), newly_insertable: insertable.map(payload) }
  validateManifest(manifest)
  const bytes = JSON.stringify(manifest, null, 2) + '\n'
  const path = resolve(option('manifest') ?? `.data/reports/repxpert-oem-apply-v2-${cutoff}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
    if (hash(await readFile(path)) !== hash(bytes)) throw new Error(`Manifest mevcut ve farklı: ${path}`)
  })
  console.log(`${selected.length.toLocaleString('tr-TR')} seçili · ${insertable.length.toLocaleString('tr-TR')} yeni key · cutoff=${cutoff}`)
  console.log(`Manifest: ${path}\nSHA-256: ${hash(bytes)}\nDRY-RUN: veritabanına yazılmadı.`)
}

async function apply(path: string): Promise<void> {
  const input = await readManifest(path); const m = input.manifest
  requireExpectedSha(input.sha256)
  const receiptPath = `${input.path}.receipt.json`
  const ids = m.selected.map((row) => BigInt(row.suggestion_id)); const insertIds = m.newly_insertable.map((row) => BigInt(row.suggestion_id))
  const startedAt = new Date().toISOString()
  const prepared = { version: 1, state: 'PREPARED', manifest_path: input.path, manifest_sha256: input.sha256,
    prepared_at: startedAt, selected_count: m.selected_count, inserted_keys: m.newly_insertable }
  await durableExclusive(receiptPath, prepared)
  const result = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<DbRow[]>`select id, product_id, value, value_norm, oem_brand from catalog.product_ref_suggestions where id<=${BigInt(m.cutoff_id)} and source_site=${SOURCE_SITE} and kind='OEM' and status='PENDING' order by id for update`
    assertLockedRows(m, locked)
    const inserted = insertIds.length === 0 ? 0 : await tx.$executeRaw`insert into catalog.product_oems (product_id, code, code_norm, oem_brand, source) select product_id, value, value_norm, oem_brand, 'WEB' from catalog.product_ref_suggestions where id=any(${insertIds}) order by id on conflict (product_id, code_norm, oem_brand) do nothing`
    if (inserted !== m.newly_insertable_count) throw new Error(`Insert count beklenen=${m.newly_insertable_count} gerçek=${inserted}`)
    const updated = await tx.$executeRaw`update catalog.product_ref_suggestions set status='APPLIED', applied_at=current_timestamp, reviewed_at=current_timestamp, reviewed_by=${REVIEWER} where id=any(${ids}) and status='PENDING'`
    if (updated !== m.selected_count) throw new Error(`Update count beklenen=${m.selected_count} gerçek=${updated}`)
    return { inserted, updated }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 900_000, maxWait: 30_000 })
  const receipt = { ...prepared, state: 'COMMITTED', committed_at: new Date().toISOString(), inserted_count: result.inserted, applied_count: result.updated }
  const receiptTemp = `${receiptPath}.tmp-${process.pid}`
  await durableExclusive(receiptTemp, receipt); await rename(receiptTemp, receiptPath)
  console.log(`Commit tamamlandı · inserted=${result.inserted} · applied=${result.updated}\nReceipt: ${receiptPath}`)
}

async function postCheck(path: string): Promise<void> {
  const input = await readManifest(path); const m = input.manifest
  requireExpectedSha(input.sha256)
  const ids = m.selected.map((row) => BigInt(row.suggestion_id)); const cutoff = BigInt(m.cutoff_id)
  const [pending, applied, missing, outside] = await Promise.all([
    db.$queryRaw<CountRow[]>`select count(*) as count from catalog.product_ref_suggestions where id=any(${ids}) and status='PENDING'`,
    db.$queryRaw<CountRow[]>`select count(*) as count from catalog.product_ref_suggestions where id=any(${ids}) and status='APPLIED' and reviewed_by=${REVIEWER}`,
    db.$queryRaw<CountRow[]>`select count(*) as count from catalog.product_ref_suggestions s where s.id=any(${ids}) and not exists (select 1 from catalog.product_oems o where o.product_id=s.product_id and o.code_norm=s.value_norm and o.oem_brand=s.oem_brand)`,
    db.$queryRaw<CountRow[]>`select count(*) as count from catalog.product_ref_suggestions where id<=${cutoff} and source_site=${SOURCE_SITE} and kind='OEM' and status='PENDING' and not (id=any(${ids}))`
  ])
  const result = { manifest_sha256: input.sha256, expected: m.selected_count, pending: Number(pending[0].count), applied: Number(applied[0].count), missing_final_keys: Number(missing[0].count), pending_outside_manifest_below_cutoff: Number(outside[0].count) }
  console.log(JSON.stringify(result, null, 2))
  if (result.pending !== 0 || result.applied !== m.selected_count || result.missing_final_keys !== 0 || result.pending_outside_manifest_below_cutoff !== 0) throw new Error('Post-check assertion başarısız')
}

async function rollback(path: string): Promise<void> {
  const input = await readManifest(path); const m = input.manifest
  requireExpectedSha(input.sha256)
  const receiptPath = `${input.path}.receipt.json`
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as { state?: string; manifest_sha256?: string; inserted_keys?: Payload[] }
  if (!['PREPARED', 'COMMITTED'].includes(receipt.state ?? '') || receipt.manifest_sha256 !== input.sha256 || JSON.stringify(receipt.inserted_keys) !== JSON.stringify(m.newly_insertable)) throw new Error('Receipt manifestle uyuşmuyor')
  const ids = m.selected.map((row) => BigInt(row.suggestion_id)); const insertIds = m.newly_insertable.map((row) => BigInt(row.suggestion_id))
  const [applied, exactWeb] = await Promise.all([
    db.$queryRaw<CountRow[]>`select count(*) as count from catalog.product_ref_suggestions where id=any(${ids}) and status='APPLIED' and reviewed_by=${REVIEWER}`,
    insertIds.length === 0 ? Promise.resolve([{ count: BigInt(0) }]) : db.$queryRaw<CountRow[]>`select count(*) as count from catalog.product_oems o join catalog.product_ref_suggestions s on s.id=any(${insertIds}) and o.product_id=s.product_id and o.code_norm=s.value_norm and o.oem_brand=s.oem_brand where o.source='WEB'`
  ])
  if (Number(applied[0].count) !== m.selected_count || Number(exactWeb[0].count) !== m.newly_insertable_count) throw new Error('Rollback ön kontrol sayıları uyuşmuyor')
  if (!args.includes('--confirm-rollback')) { console.log(`ROLLBACK DRY-RUN · ${exactWeb[0].count} OEM silinecek · ${applied[0].count} suggestion PENDING yapılacak`); return }
  await db.$transaction(async (tx) => {
    const deleted = insertIds.length === 0 ? 0 : await tx.$executeRaw`delete from catalog.product_oems o using catalog.product_ref_suggestions s where s.id=any(${insertIds}) and o.product_id=s.product_id and o.code_norm=s.value_norm and o.oem_brand=s.oem_brand and o.source='WEB'`
    if (deleted !== m.newly_insertable_count) throw new Error('Rollback delete count uyuşmuyor')
    const restored = await tx.$executeRaw`update catalog.product_ref_suggestions set status='PENDING', applied_at=null, reviewed_at=null, reviewed_by=null where id=any(${ids}) and status='APPLIED' and reviewed_by=${REVIEWER}`
    if (restored !== m.selected_count) throw new Error('Rollback update count uyuşmuyor')
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 900_000, maxWait: 30_000 })
  console.log('Rollback tamamlandı.')
}

async function main(): Promise<void> {
  if (args.includes('--apply')) throw new Error('--apply kaldırıldı; --apply-manifest=<path> kullanın')
  const applyPath = option('apply-manifest'); const checkPath = option('post-check'); const rollbackPath = option('rollback-manifest')
  if ([applyPath, checkPath, rollbackPath].filter(Boolean).length > 1) throw new Error('Apply, post-check ve rollback birlikte kullanılamaz')
  if (applyPath) return apply(applyPath)
  if (checkPath) return postCheck(checkPath)
  if (rollbackPath) return rollback(rollbackPath)
  return generate()
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
