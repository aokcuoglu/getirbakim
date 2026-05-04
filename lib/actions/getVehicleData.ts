'use server'

import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { getFromCache, setCache } from '@/lib/redis'

// Types for vehicle data (matching public schema)
export interface VehicleMake {
  id: number
  name: string
  urlKey: string | null
  isPopular: boolean | null
}

export interface VehicleModel {
  id: number
  name: string
  makeId: number
  yearFrom: number | null
  yearTo: number | null
  urlKey: string | null
}

export interface VehicleVehicle {
  id: number
  name: string
  modelId: number
  yearFrom: number | null
  yearTo: number | null
  urlKey: string | null
}

export interface VehicleFuelType {
  id: number
  name: string
  vehicleId: number
}

export interface VehicleEngine {
  id: number
  name: string
  fuelTypeId: number
}

export interface VehicleVariant {
  id: number
  name: string
  engineId: number
  yearFrom: number | null
  yearTo: number | null
  ccm: string | null
  kwPs: string | null
  engineCode: string | null
  urlKey: string | null
  tecdocId: number | null
}

// Fetch all makes
async function fetchMakes(): Promise<VehicleMake[]> {
  const result = await db.makes.findMany({
    select: {
      id: true,
      name: true,
      url_key: true,
      is_popular: true
    },
    orderBy: { name: 'asc' }
  })

  return result.map((m) => ({
    id: m.id,
    name: m.name,
    urlKey: m.url_key,
    isPopular: m.is_popular
  }))
}

// Fetch models for a specific make
async function fetchModels(makeId: number): Promise<VehicleModel[]> {
  const result = await db.models.findMany({
    where: { make_id: makeId },
    select: {
      id: true,
      name: true,
      make_id: true,
      year_from: true,
      year_to: true,
      url_key: true
    },
    orderBy: { name: 'asc' }
  })

  return result.map((m) => ({
    id: m.id,
    name: m.name,
    makeId: m.make_id,
    yearFrom: m.year_from,
    yearTo: m.year_to,
    urlKey: m.url_key
  }))
}

// Fetch vehicles for a specific model
async function fetchVehicles(modelId: number): Promise<VehicleVehicle[]> {
  const result = await db.vehicles.findMany({
    where: { model_id: modelId },
    select: {
      id: true,
      name: true,
      model_id: true,
      year_from: true,
      year_to: true,
      url_key: true
    },
    orderBy: { name: 'asc' }
  })

  return result.map((v) => ({
    id: v.id,
    name: v.name,
    modelId: v.model_id,
    yearFrom: v.year_from,
    yearTo: v.year_to,
    urlKey: v.url_key
  }))
}

// Fetch fuel types for a specific vehicle
async function fetchFuelTypes(vehicleId: number): Promise<VehicleFuelType[]> {
  const result = await db.fuel_types.findMany({
    where: { vehicle_id: vehicleId },
    select: {
      id: true,
      name: true,
      vehicle_id: true
    },
    orderBy: { name: 'asc' }
  })

  return result.map((f) => ({
    id: f.id,
    name: f.name,
    vehicleId: f.vehicle_id
  }))
}

// Fetch engines for a specific fuel type
async function fetchEngines(fuelTypeId: number): Promise<VehicleEngine[]> {
  const result = await db.engines.findMany({
    where: { fuel_type_id: fuelTypeId },
    select: {
      id: true,
      name: true,
      fuel_type_id: true
    },
    orderBy: { name: 'asc' }
  })

  return result.map((e) => ({
    id: e.id,
    name: e.name,
    fuelTypeId: e.fuel_type_id
  }))
}

// Fetch variants for a specific engine
async function fetchVariants(engineId: number): Promise<VehicleVariant[]> {
  const result = await db.variants.findMany({
    where: { engine_id: engineId },
    select: {
      id: true,
      name: true,
      engine_id: true,
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

  return result.map((v) => ({
    id: v.id,
    name: v.name,
    engineId: v.engine_id,
    yearFrom: v.year_from,
    yearTo: v.year_to,
    ccm: v.ccm,
    kwPs: v.kw_ps,
    engineCode: v.engine_code,
    urlKey: v.url_key,
    tecdocId: v.tecdoc_id
  }))
}

// Cached version of makes (1 hour cache)
export const getMakes = async () =>
  await unstable_cache(fetchMakes, ['vehicle-makes'], {
    revalidate: 3600
  })()

// These are called on-demand as user navigates the hierarchy
export async function getModels(makeId: number): Promise<VehicleModel[]> {
  return fetchModels(makeId)
}

export async function getVehicles(modelId: number): Promise<VehicleVehicle[]> {
  return fetchVehicles(modelId)
}

export async function getFuelTypes(
  vehicleId: number
): Promise<VehicleFuelType[]> {
  return fetchFuelTypes(vehicleId)
}

export async function getEngines(fuelTypeId: number): Promise<VehicleEngine[]> {
  return fetchEngines(fuelTypeId)
}

export async function getVariants(engineId: number): Promise<VehicleVariant[]> {
  return fetchVariants(engineId)
}

// Get variant by URL key (for URL-based lookups)
export async function getVariantByUrlKey(
  urlKey: string
): Promise<VehicleVariant | null> {
  const result = await db.variants.findFirst({
    where: { url_key: urlKey },
    select: {
      id: true,
      name: true,
      engine_id: true,
      year_from: true,
      year_to: true,
      ccm: true,
      kw_ps: true,
      engine_code: true,
      url_key: true,
      tecdoc_id: true
    }
  })

  if (!result) return null

  return {
    id: result.id,
    name: result.name,
    engineId: result.engine_id,
    yearFrom: result.year_from,
    yearTo: result.year_to,
    ccm: result.ccm,
    kwPs: result.kw_ps,
    engineCode: result.engine_code,
    urlKey: result.url_key,
    tecdocId: result.tecdoc_id
  }
}

// Get tecdoc_id by variant ID
export async function getTecDocIdByVariantId(
  variantId: number
): Promise<number | null> {
  const result = await db.variants.findUnique({
    where: { id: variantId },
    select: { tecdoc_id: true }
  })

  return result?.tecdoc_id || null
}

export async function getResolvedVehicleTypeIdByVariantId(
  variantId: number
): Promise<{ vehicleTypeId: number | null; failed: boolean }> {
  const cacheKey = `vehicle-type-resolve-v1-${variantId}`

  try {
    const cached = await getFromCache<{ vehicleTypeId: number | null; failed: boolean }>(
      cacheKey
    )
    if (cached) return cached

    const tecdocId = await unstable_cache(
      async (id: number) => getTecDocIdByVariantId(id),
      ['vehicle-type-resolve-v1', String(variantId)],
      { revalidate: 86400 }
    )(variantId)

    if (tecdocId) {
      const result = { vehicleTypeId: tecdocId, failed: false }
      setCache(cacheKey, result, 86400).catch(() => {})
      return result
    }

    const vehicleTypeExists = await db.part_vehicle_types.findFirst({
      where: { vehicle_type_id: variantId },
      select: { vehicle_type_id: true }
    })

    if (vehicleTypeExists) {
      const result = { vehicleTypeId: variantId, failed: false }
      setCache(cacheKey, result, 86400).catch(() => {})
      return result
    }

    const result = { vehicleTypeId: null, failed: true }
    setCache(cacheKey, result, 3600).catch(() => {})
    return result
  } catch (error) {
    console.error('Failed to resolve vehicle type id:', error)
    return { vehicleTypeId: null, failed: true }
  }
}
