/**
 * Type definitions for Vehicle Hierarchy
 */

/**
 * Base interface for hierarchy items
 * Used across all levels: Makes, Models, Vehicles, FuelTypes, Engines
 */
export interface HierarchyItem {
  id: number
  name: string
  dateFrom?: string | null
  dateTo?: string | null
}

/**
 * Extended interface for Variants with additional details
 */
export interface VariantItem extends HierarchyItem {
  yearFrom?: number | null
  yearTo?: number | null
  ccm?: string | null
  kwPs?: string | null
  engineCode?: string | null
  urlKey?: string | null
  vehicleTypeId?: number | null
  tecdocId?: number | null
  fuelType?: string | null
}

/**
 * Union type for dropdown data return
 */
export type DropdownItem = HierarchyItem | VariantItem

/**
 * Hierarchy levels for the vehicle selector
 */
export type HierarchyLevel =
  | 'makes'
  | 'models'
  | 'vehicles'
  | 'fuel_types'
  | 'engines'
  | 'variants'
  | 'vehicle_brands'
  | 'vehicle_models'
  | 'vehicle_types'

/**
 * Configuration for each hierarchy level
 */
export interface HierarchyLevelConfig {
  table: string
  parentColumn: string | null
  redisKeyPrefix: string
}

/**
 * Hierarchy level configurations
 */
export const HIERARCHY_CONFIG: Record<HierarchyLevel, HierarchyLevelConfig> = {
  makes: {
    table: 'makes',
    parentColumn: null,
    redisKeyPrefix: 'ref:makes'
  },
  models: {
    table: 'models',
    parentColumn: 'make_id',
    redisKeyPrefix: 'ref:models'
  },
  vehicles: {
    table: 'vehicles',
    parentColumn: 'model_id',
    redisKeyPrefix: 'ref:vehicles'
  },
  fuel_types: {
    table: 'fuel_types',
    parentColumn: 'vehicle_id',
    redisKeyPrefix: 'ref:fuel_types'
  },
  engines: {
    table: 'engines',
    parentColumn: 'fuel_type_id',
    redisKeyPrefix: 'ref:engines'
  },
  variants: {
    table: 'variants',
    parentColumn: 'engine_id',
    redisKeyPrefix: 'ref:variants'
  },
  vehicle_brands: {
    table: 'vbrands',
    parentColumn: null,
    redisKeyPrefix: 'ref:v_brands'
  },
  vehicle_models: {
    table: 'vmodels',
    parentColumn: 'brand_id',
    redisKeyPrefix: 'ref:v_models'
  },
  vehicle_types: {
    table: 'vtypes',
    parentColumn: 'model_id',
    redisKeyPrefix: 'ref:v_types'
  }
}

/**
 * Cache TTL for hierarchy data (7 days in seconds)
 * This data is static and rarely changes
 */
export const HIERARCHY_CACHE_TTL = 7 * 24 * 60 * 60 // 604,800 seconds
