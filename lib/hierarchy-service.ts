/**
 * Vehicle Hierarchy Service
 *
 * Provides performant access to the 6-level vehicle hierarchy:
 * Makes -> Models -> Vehicles -> Fuel_Types -> Engines -> Variants
 *
 * Features:
 * - Redis caching with 7-day TTL
 * - Single getDropdownData function for all levels
 * - isPopular sorting for makes
 * - Type-safe responses
 */

import { db } from '@/lib/db'
import { getFromCache, setCache, isRedisAvailable } from '@/lib/redis'
import {
  type HierarchyItem,
  type VariantItem,
  type HierarchyLevel,
  type DropdownItem,
  HIERARCHY_CACHE_TTL
} from '@/lib/types/hierarchy'

const HIERARCHY_DEBUG = process.env.HIERARCHY_SERVICE_DEBUG === 'true'

function debugLog(message: string) {
  if (HIERARCHY_DEBUG) {
    console.log(message)
  }
}

// ============================================================================
// Redis Key Generators
// ============================================================================

/**
 * Generate Redis key for a hierarchy level
 */
function getRedisKey(entity: HierarchyLevel, parentId?: number): string {
  switch (entity) {
    case 'makes':
      return 'ref:makes'
    case 'models':
      return `ref:models:${parentId}`
    case 'vehicles':
      return `ref:vehicles:${parentId}`
    case 'fuel_types':
      return `ref:fuel_types:${parentId}`
    case 'engines':
      return `ref:engines:${parentId}`
    case 'variants':
      return `ref:variants:${parentId}`
    case 'vehicle_brands':
      return 'ref:v_brands'
    case 'vehicle_models':
      return `ref:v_models:${parentId}`
    case 'vehicle_types':
      return `ref:v_types:${parentId}`
    default:
      throw new Error(`Unknown entity: ${entity}`)
  }
}

// ============================================================================
// Database Fetchers
// ============================================================================

/**
 * Fetch makes from database
 * Sorted by isPopular DESC, then name ASC
 */
async function fetchMakes(): Promise<HierarchyItem[]> {
  const data = await db.makes.findMany({
    select: { id: true, name: true },
    orderBy: [{ is_popular: 'desc' }, { name: 'asc' }]
  })

  return data
}

/**
 * Fetch models from database by makeId
 */
async function fetchModels(makeId: number): Promise<HierarchyItem[]> {
  const data = await db.models.findMany({
    where: { make_id: makeId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  })

  return data
}

/**
 * Fetch vehicles from database by modelId
 */
async function fetchVehicles(modelId: number): Promise<HierarchyItem[]> {
  const data = await db.vehicles.findMany({
    where: { model_id: modelId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  })

  return data
}

/**
 * Fetch fuel types from database by vehicleId
 */
async function fetchFuelTypes(vehicleId: number): Promise<HierarchyItem[]> {
  const data = await db.fuel_types.findMany({
    where: { vehicle_id: vehicleId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  })

  return data
}

/**
 * Fetch engines from database by fuelTypeId
 */
async function fetchEngines(fuelTypeId: number): Promise<HierarchyItem[]> {
  const data = await db.engines.findMany({
    where: { fuel_type_id: fuelTypeId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  })

  return data
}

/**
 * Fetch variants from database by engineId
 * Includes additional fields for dropdown display
 */
async function fetchVariants(engineId: number): Promise<VariantItem[]> {
  const data = await db.variants.findMany({
    where: { engine_id: engineId },
    select: {
      id: true,
      name: true,
      year_from: true,
      year_to: true,
      ccm: true,
      kw_ps: true,
      engine_code: true,
      url_key: true,
      tecdoc_id: true
    },
    orderBy: { name: 'asc' }
  })

  return data.map((v) => ({
    id: v.id,
    name: v.name,
    yearFrom: v.year_from,
    yearTo: v.year_to,
    ccm: v.ccm,
    kwPs: v.kw_ps,
    engineCode: v.engine_code,
    urlKey: v.url_key,
    tecdocId: v.tecdoc_id
  }))
}
/**
 * Fetch vehicle brands from database
 */
async function fetchVehicleBrands(): Promise<HierarchyItem[]> {
  const data = await db.vehicle_brands.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  })
  return data
}

/**
 * Fetch vehicle models from database by brandId
 */
async function fetchVehicleModels(brandId: number): Promise<HierarchyItem[]> {
  const data = await db.vehicle_models.findMany({
    where: { brand_id: brandId },
    select: { id: true, name: true, date_from: true, date_to: true },
    orderBy: { name: 'asc' }
  })

  return data.map((model) => ({
    id: model.id,
    name: model.name,
    dateFrom: model.date_from,
    dateTo: model.date_to
  }))
}

/**
 * Fetch vehicle types from database by modelId
 */
// Helper to generate slugs
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function fetchVehicleTypes(modelId: number): Promise<VariantItem[]> {
  const data = await db.vehicle_types.findMany({
    where: { model_id: modelId },
    select: {
      id: true,
      name: true,
      cc: true,
      fuel_type: true,
      hp: true,
      kwt: true,
      year_of_constr_from: true,
      year_of_constr_to: true
    },
    orderBy: { name: 'asc' }
  })

  return data.map((v) => ({
    id: v.id,
    name: v.name,
    yearFrom: v.year_of_constr_from ? parseInt(v.year_of_constr_from) : null,
    yearTo: v.year_of_constr_to ? parseInt(v.year_of_constr_to) : null,
    ccm: v.cc ? v.cc.toString() : null,
    kwPs: v.kwt && v.hp ? `${v.kwt} kW / ${v.hp} hp` : null,
    fuelType: v.fuel_type,
    vehicleTypeId: v.id,
    // Generate a URL key since the table doesn't have one
    // Format: name-id-vtid (vtid = vehicle type id suffix to distinguish from variants)
    urlKey: `${slugify(v.name)}-${v.id}-vtid`
  }))
}

// ============================================================================
// Cache-Through Fetch Helper
// ============================================================================

/**
 * Generic cache-through fetch helper
 */
async function fetchWithCache<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Try Redis first
  if (isRedisAvailable()) {
    const cached = await getFromCache<T>(cacheKey)
    if (cached !== null) {
      debugLog(`[HierarchyService] Cache HIT: ${cacheKey}`)
      return cached
    }
    debugLog(`[HierarchyService] Cache MISS: ${cacheKey}`)
  }

  // Fetch from database
  const data = await fetchFn()

  // Store in Redis (non-blocking)
  if (isRedisAvailable()) {
    setCache(cacheKey, data, HIERARCHY_CACHE_TTL).catch((err) => {
      console.error(`[HierarchyService] Failed to cache ${cacheKey}:`, err)
    })
  }

  return data
}

// ============================================================================
// Main API: getDropdownData
// ============================================================================

/**
 * Get dropdown data for any hierarchy level
 *
 * @param entity - The hierarchy level to fetch ('makes', 'models', etc.)
 * @param parentId - The parent ID (required for all levels except 'makes')
 * @returns Array of dropdown items with id and name (variants include extra fields)
 *
 * @example
 * // Get all makes (isPopular first)
 * const makes = await getDropdownData('makes')
 *
 * @example
 * // Get models for a specific make
 * const models = await getDropdownData('models', 5)
 *
 * @example
 * // Get variants with extra details
 * const variants = await getDropdownData('variants', 123)
 */
export async function getDropdownData(
  entity: HierarchyLevel,
  parentId?: number
): Promise<DropdownItem[]> {
  // Validate parentId requirement
  if (
    entity !== 'makes' &&
    entity !== 'vehicle_brands' &&
    parentId === undefined
  ) {
    throw new Error(`parentId is required for entity: ${entity}`)
  }

  const cacheKey = getRedisKey(entity, parentId)
  debugLog(
    `[HierarchyService] getDropdownData called for ${entity} with parentId ${parentId}`
  )

  let brandsCount = 0
  if (entity === 'vehicle_brands') {
    brandsCount = await db.vehicle_brands.count()
    debugLog(`[HierarchyService] Total brands in DB: ${brandsCount}`)
  }

  try {
    let result: DropdownItem[] = []
    switch (entity) {
      case 'makes':
        result = await fetchWithCache<HierarchyItem[]>(cacheKey, fetchMakes)
        break

      case 'models':
        result = await fetchWithCache<HierarchyItem[]>(cacheKey, () =>
          fetchModels(parentId!)
        )
        break

      case 'vehicles':
        result = await fetchWithCache<HierarchyItem[]>(cacheKey, () =>
          fetchVehicles(parentId!)
        )
        break

      case 'fuel_types':
        result = await fetchWithCache<HierarchyItem[]>(cacheKey, () =>
          fetchFuelTypes(parentId!)
        )
        break

      case 'engines':
        result = await fetchWithCache<HierarchyItem[]>(cacheKey, () =>
          fetchEngines(parentId!)
        )
        break

      case 'variants':
        result = await fetchWithCache<VariantItem[]>(cacheKey, () =>
          fetchVariants(parentId!)
        )
        break

      case 'vehicle_brands':
        result = await fetchWithCache<HierarchyItem[]>(
          cacheKey,
          fetchVehicleBrands
        )
        break

      case 'vehicle_models':
        result = await fetchWithCache<HierarchyItem[]>(cacheKey, () =>
          fetchVehicleModels(parentId!)
        )
        break

      case 'vehicle_types':
        result = await fetchWithCache<VariantItem[]>(cacheKey, () =>
          fetchVehicleTypes(parentId!)
        )
        break

      default:
        throw new Error(`Unknown entity: ${entity}`)
    }
    debugLog(
      `[HierarchyService] Returning ${result.length} items for ${entity}`
    )
    return result
  } catch (err) {
    console.error(
      `[HierarchyService] Error in getDropdownData for ${entity}:`,
      err
    )
    throw err
  }
}

// ============================================================================
// Convenience Functions (Optional - for direct usage)
// ============================================================================

export const getMakes = () => getDropdownData('makes')
export const getModels = (makeId: number) => getDropdownData('models', makeId)
export const getVehicles = (modelId: number) =>
  getDropdownData('vehicles', modelId)
export const getFuelTypes = (vehicleId: number) =>
  getDropdownData('fuel_types', vehicleId)
export const getEngines = (fuelTypeId: number) =>
  getDropdownData('engines', fuelTypeId)
export const getVariants = (engineId: number) =>
  getDropdownData('variants', engineId)
