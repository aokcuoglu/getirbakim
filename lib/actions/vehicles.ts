'use server'

import { db } from '@/lib/db'

export type VehicleNode = {
  id: string // We'll convert DB integers to string for the UI to be consistent
  label: string
  type: 'MAKE' | 'MODEL' | 'VEHICLE' | 'FUEL' | 'ENGINE' | 'VARIANT'
  payload?: any
  hasChildren?: boolean // To indicate if we should fetch deeper
}

export async function getMakes(): Promise<VehicleNode[]> {
  const data = await db.makes.findMany({
    where: { is_popular: true },
    orderBy: { name: 'asc' }
  })

  return data.map((item) => ({
    id: item.id.toString(),
    label: item.name,
    type: 'MAKE',
    hasChildren: true
  }))
}

export async function getModels(makeId: string): Promise<VehicleNode[]> {
  const data = await db.models.findMany({
    where: { make_id: parseInt(makeId) },
    orderBy: { name: 'asc' }
  })

  return data.map((item) => ({
    id: item.id.toString(),
    label: item.name,
    type: 'MODEL',
    hasChildren: true
  }))
}

export async function getVehicles(modelId: string): Promise<VehicleNode[]> {
  const data = await db.vehicles.findMany({
    where: { model_id: parseInt(modelId) },
    orderBy: { name: 'asc' }
  })

  return data.map((item) => ({
    id: item.id.toString(),
    label: item.name,
    type: 'VEHICLE',
    hasChildren: true
  }))
}

export async function getFuelTypes(vehicleId: string): Promise<VehicleNode[]> {
  const data = await db.fuel_types.findMany({
    where: { vehicle_id: parseInt(vehicleId) },
    orderBy: { name: 'asc' }
  })

  return data.map((item) => ({
    id: item.id.toString(),
    label: item.name,
    type: 'FUEL',
    hasChildren: true
  }))
}

export async function getEngines(fuelTypeId: string): Promise<VehicleNode[]> {
  const data = await db.engines.findMany({
    where: { fuel_type_id: parseInt(fuelTypeId) },
    orderBy: { name: 'asc' }
  })

  return data.map((item) => ({
    id: item.id.toString(),
    label: item.name,
    type: 'ENGINE',
    hasChildren: true
  }))
}

export async function getVariants(engineId: string): Promise<VehicleNode[]> {
  const data = await db.variants.findMany({
    where: { engine_id: parseInt(engineId) },
    orderBy: { name: 'asc' }
  })

  return data.map((item) => ({
    id: item.id.toString(),
    label: item.name,
    type: 'VARIANT',
    hasChildren: false,
    payload: {
      yearFrom: item.year_from,
      yearTo: item.year_to,
      ccm: item.ccm,
      kwPs: item.kw_ps,
      engineCode: item.engine_code,
      tecdocId: item.tecdoc_id,
      urlKey: item.url_key
    }
  }))
}

export async function getVariantByUrlKey(urlKey: string) {
  const data = await db.variants.findFirst({
    where: { url_key: urlKey }
  })

  if (!data) {
    return null
  }

  return {
    id: data.id,
    name: data.name,
    tecdocId: data.tecdoc_id,
    urlKey: data.url_key,
    yearFrom: data.year_from,
    yearTo: data.year_to
  }
}
