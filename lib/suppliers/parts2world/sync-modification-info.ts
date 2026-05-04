import 'dotenv/config'
import { db } from '../../db'
import {
  appendSyncError,
  buildResumeKey,
  deleteDbCheckpoint,
  getParts2WorldBaseUrls,
  normalizeText,
  parseArgValue,
  parseBoolean,
  parseIntList,
  parsePositiveInt,
  readDbCheckpoint,
  startSyncRun,
  updateSyncRun,
  withRetry,
  writeDbCheckpoint
} from './common'

type Config = {
  vehicleTypeIds: number[]
  offset: number
  limit: number | null
  resume: boolean
  resumeKey: string | null
  resetResume: boolean
  dryRun: boolean
  shardCount: number
  shardIndex: number
}

type ModificationInfoData = {
  brakeSystem?: string
  carId?: number
  ccmTech?: number
  constructionType?: string
  cylinder?: number
  cylinderCapacityCcm?: number
  cylinderCapacityLiter?: number
  fuelType?: string
  fuelTypeProcess?: string
  impulsionType?: string
  manuId?: number
  manuName?: string
  modId?: number
  modelName?: string
  motorType?: string
  powerHpFrom?: number
  powerHpTo?: number
  powerKwFrom?: number
  powerKwTo?: number
  typeName?: string
  typeNumber?: number
  valves?: number
  yearOfConstrFrom?: string
  yearOfConstrTo?: string
  rmiTypeId?: number
  motorCodes?: string[]
}

type ModificationInfoResponse = {
  data?: ModificationInfoData
}

type ResumePayload = {
  lastVehicleTypeId: number
  processed: number
  updated: number
  failed: number
  skipped: number
}

const SCRIPT_NAME = 'sync-modification-info'

function parseNonNegativeInt(value: string | null | undefined): number | null {
  if (value == null) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  const intValue = Math.trunc(num)
  return intValue >= 0 ? intValue : null
}

function buildConfig(): Config {
  const shardCount = Math.max(
    1,
    parsePositiveInt(parseArgValue('shard-count')) || 1
  )
  const shardIndex = parseNonNegativeInt(parseArgValue('shard-index')) || 0
  if (shardIndex >= shardCount) {
    throw new Error(
      `Invalid shard index: shard-index=${shardIndex} shard-count=${shardCount}`
    )
  }

  const vehicleTypeIds = parseIntList(parseArgValue('vehicle-type-id'))

  return {
    vehicleTypeIds,
    offset: Math.max(0, parsePositiveInt(parseArgValue('offset')) || 0),
    limit: parsePositiveInt(parseArgValue('limit')),
    resume:
      parseArgValue('resume') == null
        ? true
        : parseBoolean(parseArgValue('resume')),
    resumeKey: normalizeText(parseArgValue('resume-key')),
    resetResume: parseBoolean(parseArgValue('reset-resume')),
    dryRun: parseBoolean(parseArgValue('dry-run')),
    shardCount,
    shardIndex
  }
}

function mapApiBase(baseUrl: string): string {
  return `${baseUrl}/api/v2/tecdoc`
}

async function fetchFromBases<T>(
  baseUrls: string[],
  endpointPath: string,
  contextLabel: string
): Promise<T> {
  const errors: string[] = []

  for (const baseUrl of baseUrls) {
    const url = `${mapApiBase(baseUrl)}${endpointPath}`

    try {
      const response = await withRetry(
        () =>
          fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'application/json'
            }
          }),
        2
      )

      if (!response.ok) {
        errors.push(`${url} => ${response.status}`)
        continue
      }

      return (await response.json()) as T
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${url} => ${message}`)
    }
  }

  throw new Error(`${contextLabel} failed. ${errors.slice(0, 5).join(' | ')}`)
}

async function main() {
  const startedAt = Date.now()
  const config = buildConfig()
  const baseUrls = getParts2WorldBaseUrls()
  const effectiveResumeKey =
    config.resumeKey ||
    buildResumeKey('modification-info', {
      vehicleTypeIds: config.vehicleTypeIds,
      offset: config.offset,
      limit: config.limit,
      shardCount: config.shardCount,
      shardIndex: config.shardIndex
    })

  const runId = await startSyncRun({
    scriptName: SCRIPT_NAME,
    resumeKey: effectiveResumeKey,
    args: {
      vehicleTypeIds: config.vehicleTypeIds,
      offset: config.offset,
      limit: config.limit,
      resume: config.resume,
      resetResume: config.resetResume,
      dryRun: config.dryRun,
      shardCount: config.shardCount,
      shardIndex: config.shardIndex
    }
  })

  let processed = 0
  let updated = 0
  let failed = 0
  let skipped = 0

  try {
    if (config.resetResume) {
      await deleteDbCheckpoint(SCRIPT_NAME, effectiveResumeKey)
      console.log(`Checkpoint reset key=${effectiveResumeKey}`)
    }

    const sourceRows = await db.vehicle_types.findMany({
      where:
        config.vehicleTypeIds.length > 0
          ? { id: { in: config.vehicleTypeIds } }
          : undefined,
      select: { id: true },
      orderBy: { id: 'asc' },
      skip: config.offset,
      take: config.limit || undefined
    })

    const vehicleTypeIds = sourceRows
      .map((row) => row.id)
      .filter((id) => id % config.shardCount === config.shardIndex)

    if (vehicleTypeIds.length === 0) {
      console.log('No vehicle types selected for modification-info sync.')
      await updateSyncRun({
        runId,
        status: 'completed',
        counters: { processed, updated, failed, skipped },
        finished: true
      })
      return
    }

    let startIndex = 0
    if (config.resume) {
      const checkpoint = await readDbCheckpoint<ResumePayload>(
        SCRIPT_NAME,
        effectiveResumeKey
      )
      if (checkpoint?.payload?.lastVehicleTypeId) {
        const cursorId = checkpoint.payload.lastVehicleTypeId
        const index = vehicleTypeIds.findIndex((id) => id > cursorId)
        startIndex = index >= 0 ? index : vehicleTypeIds.length
        processed = checkpoint.payload.processed || 0
        updated = checkpoint.payload.updated || 0
        failed = checkpoint.payload.failed || 0
        skipped = checkpoint.payload.skipped || 0
        console.log(
          `Resume loaded key=${effectiveResumeKey} lastVehicleTypeId=${cursorId} nextIndex=${startIndex}`
        )
      }
    }

    for (let i = startIndex; i < vehicleTypeIds.length; i += 1) {
      const vehicleTypeId = vehicleTypeIds[i]
      const urlPath = `/modification-info/${vehicleTypeId}/`

      try {
        const payload = await fetchFromBases<ModificationInfoResponse>(
          baseUrls,
          urlPath,
          `modification-info(${vehicleTypeId})`
        )
        const data = payload?.data
        if (!data) {
          skipped += 1
          await appendSyncError({
            runId,
            scriptName: SCRIPT_NAME,
            stage: 'fetch-modification-info',
            entityType: 'vehicle_type',
            entityId: String(vehicleTypeId),
            requestUrl: `${mapApiBase(baseUrls[0])}${urlPath}`,
            message: 'Empty data payload from modification-info endpoint.'
          })
        } else if (!config.dryRun) {
          await db.$executeRawUnsafe(
            `
              INSERT INTO public.vehicle_type_modifications (
                vehicle_type_id,
                brake_system,
                car_id,
                ccm_tech,
                construction_type,
                cylinder,
                cylinder_capacity_ccm,
                cylinder_capacity_liter,
                fuel_type,
                fuel_type_process,
                impulsion_type,
                manu_id,
                manu_name,
                mod_id,
                model_name,
                motor_type,
                power_hp_from,
                power_hp_to,
                power_kw_from,
                power_kw_to,
                type_name,
                type_number,
                valves,
                year_of_constr_from,
                year_of_constr_to,
                rmi_type_id,
                motor_codes,
                raw_payload,
                updated_at
              )
              VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27::jsonb,$28::jsonb,CURRENT_TIMESTAMP
              )
              ON CONFLICT (vehicle_type_id)
              DO UPDATE SET
                brake_system = EXCLUDED.brake_system,
                car_id = EXCLUDED.car_id,
                ccm_tech = EXCLUDED.ccm_tech,
                construction_type = EXCLUDED.construction_type,
                cylinder = EXCLUDED.cylinder,
                cylinder_capacity_ccm = EXCLUDED.cylinder_capacity_ccm,
                cylinder_capacity_liter = EXCLUDED.cylinder_capacity_liter,
                fuel_type = EXCLUDED.fuel_type,
                fuel_type_process = EXCLUDED.fuel_type_process,
                impulsion_type = EXCLUDED.impulsion_type,
                manu_id = EXCLUDED.manu_id,
                manu_name = EXCLUDED.manu_name,
                mod_id = EXCLUDED.mod_id,
                model_name = EXCLUDED.model_name,
                motor_type = EXCLUDED.motor_type,
                power_hp_from = EXCLUDED.power_hp_from,
                power_hp_to = EXCLUDED.power_hp_to,
                power_kw_from = EXCLUDED.power_kw_from,
                power_kw_to = EXCLUDED.power_kw_to,
                type_name = EXCLUDED.type_name,
                type_number = EXCLUDED.type_number,
                valves = EXCLUDED.valves,
                year_of_constr_from = EXCLUDED.year_of_constr_from,
                year_of_constr_to = EXCLUDED.year_of_constr_to,
                rmi_type_id = EXCLUDED.rmi_type_id,
                motor_codes = EXCLUDED.motor_codes,
                raw_payload = EXCLUDED.raw_payload,
                updated_at = CURRENT_TIMESTAMP
            `,
            vehicleTypeId,
            data.brakeSystem || null,
            data.carId || null,
            data.ccmTech || null,
            data.constructionType || null,
            data.cylinder || null,
            data.cylinderCapacityCcm || null,
            data.cylinderCapacityLiter || null,
            data.fuelType || null,
            data.fuelTypeProcess || null,
            data.impulsionType || null,
            data.manuId || null,
            data.manuName || null,
            data.modId || null,
            data.modelName || null,
            data.motorType || null,
            data.powerHpFrom || null,
            data.powerHpTo || null,
            data.powerKwFrom || null,
            data.powerKwTo || null,
            data.typeName || null,
            data.typeNumber || null,
            data.valves || null,
            data.yearOfConstrFrom || null,
            data.yearOfConstrTo || null,
            data.rmiTypeId || null,
            JSON.stringify(data.motorCodes || []),
            JSON.stringify(data)
          )
          updated += 1
        } else {
          updated += 1
        }
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        await appendSyncError({
          runId,
          scriptName: SCRIPT_NAME,
          stage: 'process-vehicle-type',
          entityType: 'vehicle_type',
          entityId: String(vehicleTypeId),
          requestUrl: `${mapApiBase(baseUrls[0])}${urlPath}`,
          message,
          context: { vehicleTypeId }
        })
      }

      processed += 1
      const checkpointPayload: ResumePayload = {
        lastVehicleTypeId: vehicleTypeId,
        processed,
        updated,
        failed,
        skipped
      }
      if (config.resume) {
        await writeDbCheckpoint({
          scriptName: SCRIPT_NAME,
          resumeKey: effectiveResumeKey,
          runId,
          cursor: String(vehicleTypeId),
          payload: checkpointPayload
        })
      }

      await updateSyncRun({
        runId,
        counters: { processed, updated, failed, skipped },
        checkpointCursor: String(vehicleTypeId),
        checkpointPayload
      })

      if (processed % 25 === 0) {
        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
        console.log(
          `Progress ${processed}/${vehicleTypeIds.length} updated=${updated} failed=${failed} skipped=${skipped} elapsed=${elapsedSec}s`
        )
      }
    }

    if (config.resume) {
      await deleteDbCheckpoint(SCRIPT_NAME, effectiveResumeKey)
    }

    await updateSyncRun({
      runId,
      status: 'completed',
      counters: { processed, updated, failed, skipped },
      finished: true
    })

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(
      `Modification-info sync done. processed=${processed} updated=${updated} failed=${failed} skipped=${skipped} elapsed=${elapsedSec}s`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendSyncError({
      runId,
      scriptName: SCRIPT_NAME,
      stage: 'fatal',
      message
    })
    await updateSyncRun({
      runId,
      status: 'failed',
      counters: { processed, updated, failed: failed + 1, skipped },
      finished: true
    })
    throw error
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`parts2world modification-info sync failed: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
