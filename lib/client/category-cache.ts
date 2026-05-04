'use client'

import {
  getPartCategories,
  getPartCategoriesForVehicle,
  type PartCategory
} from '@/lib/actions/getPartCategories'

const dataCache = new Map<string, PartCategory[]>()
const pendingCache = new Map<string, Promise<PartCategory[]>>()

async function getOrLoad(
  key: string,
  loader: () => Promise<PartCategory[]>
): Promise<PartCategory[]> {
  const cached = dataCache.get(key)
  if (cached) return cached

  const pending = pendingCache.get(key)
  if (pending) return pending

  const request = loader()
    .then((data) => {
      dataCache.set(key, data)
      return data
    })
    .finally(() => {
      pendingCache.delete(key)
    })

  pendingCache.set(key, request)
  return request
}

export function getCachedPartCategories(locale: string): Promise<PartCategory[]> {
  return getOrLoad(`all:${locale}`, () => getPartCategories(locale))
}

export function getCachedPartCategoriesForVehicle(
  vehicleTypeId: number,
  locale: string
): Promise<PartCategory[]> {
  return getOrLoad(`vehicle:${vehicleTypeId}:${locale}`, () =>
    getPartCategoriesForVehicle(vehicleTypeId, locale)
  )
}

export async function warmCategoryCaches(
  locale: string,
  vehicleTypeId?: number | null
): Promise<void> {
  if (vehicleTypeId) {
    await Promise.all([
      getCachedPartCategories(locale),
      getCachedPartCategoriesForVehicle(vehicleTypeId, locale)
    ])
    return
  }

  await getCachedPartCategories(locale)
}
