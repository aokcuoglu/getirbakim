'use server'

/**
 * Vehicle Selector Server Actions
 *
 * Server Actions for the vehicle hierarchy selector component.
 * Uses the HierarchyService for Redis-cached data fetching.
 */

import { z } from 'zod'
import { getDropdownData } from '@/lib/hierarchy-service'
import type { HierarchyLevel, DropdownItem } from '@/lib/types/hierarchy'

/**
 * Zod schema for input validation
 */
const hierarchyLevelSchema = z.enum([
  'makes',
  'models',
  'vehicles',
  'fuel_types',
  'engines',
  'variants',
  'vehicle_brands',
  'vehicle_models',
  'vehicle_types'
])

const getDropdownDataSchema = z.object({
  entity: hierarchyLevelSchema,
  parentId: z.number().optional()
})

/**
 * Response type for dropdown data actions
 */
export interface DropdownDataResponse {
  success: boolean
  data?: DropdownItem[]
  error?: string
}

/**
 * Get dropdown data for a specific hierarchy level
 *
 * @example
 * // Get all makes (isPopular first)
 * const makes = await getDropdownDataAction({ entity: 'makes' })
 *
 * @example
 * // Get models for a specific make
 * const models = await getDropdownDataAction({ entity: 'models', parentId: 5 })
 */
export async function getDropdownDataAction(input: {
  entity: HierarchyLevel
  parentId?: number
}): Promise<DropdownDataResponse> {
  // Validate input with Zod
  const parsed = getDropdownDataSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: 'Geçersiz parametre: ' + parsed.error.issues[0].message
    }
  }

  const { entity, parentId } = parsed.data

  // Validate parentId requirement for non-root levels
  if (
    entity !== 'makes' &&
    entity !== 'vehicle_brands' &&
    parentId === undefined
  ) {
    return {
      success: false,
      error: `"${entity}" için parentId gereklidir`
    }
  }

  try {
    const data = await getDropdownData(entity, parentId)

    return {
      success: true,
      data
    }
  } catch (error) {
    console.error(`[VehicleSelector] Error fetching ${entity}:`, error)

    return {
      success: false,
      error: 'Veri alınırken bir hata oluştu. Lütfen tekrar deneyin.'
    }
  }
}

// ============================================================================
// Convenience Actions - Type-safe shortcuts for each level
// ============================================================================

/**
 * Get all vehicle makes (isPopular first)
 */
export async function getMakesAction(): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'makes' })
}

/**
 * Get models for a specific make
 */
export async function getModelsAction(
  makeId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'models', parentId: makeId })
}

/**
 * Get vehicles for a specific model
 */
export async function getVehiclesAction(
  modelId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'vehicles', parentId: modelId })
}

/**
 * Get fuel types for a specific vehicle
 */
export async function getFuelTypesAction(
  vehicleId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'fuel_types', parentId: vehicleId })
}

/**
 * Get engines for a specific fuel type
 */
export async function getEnginesAction(
  fuelTypeId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'engines', parentId: fuelTypeId })
}

/**
 * Get variants for a specific engine (includes extra fields)
 */
export async function getVariantsAction(
  engineId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'variants', parentId: engineId })
}

/**
 * Get all vehicle brands
 */
export async function getVehicleBrandsAction(): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'vehicle_brands' })
}

/**
 * Get vehicle models for a specific brand
 */
export async function getVehicleModelsAction(
  brandId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'vehicle_models', parentId: brandId })
}

/**
 * Get vehicle types for a specific model
 */
export async function getVehicleTypesAction(
  modelId: number
): Promise<DropdownDataResponse> {
  return getDropdownDataAction({ entity: 'vehicle_types', parentId: modelId })
}
