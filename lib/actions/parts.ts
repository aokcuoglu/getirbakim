'use server'

import { db } from '@/lib/db'

export type AppCategory = {
  id: number
  name: string
  partCount: number
  image?: string | null
}

export type AppPart = {
  id: number
  name: string
  brand: string
  categoryId: number
  categoryName: string
  price: string | null
  image: string | null
  articleLinkId: number
}

/**
 * Verilen vehicleTypeId (tecdocId) için mevcut parça kategorilerini getirir.
 * Bu fonksiyon db.app schema'sından veri çeker.
 */
export async function getCategoriesByVehicleTypeId(
  vehicleTypeId: number
): Promise<AppCategory[]> {
  try {
    // First check if the vehicle type exists
    const vehicleType = await db.vehicle_types.findFirst({
      where: { id: vehicleTypeId },
      select: { id: true }
    })

    if (!vehicleType) {
      console.log(
        `[getCategoriesByVehicleTypeId] Vehicle type ${vehicleTypeId} not found`
      )
      return []
    }

    // Get all part IDs for this vehicle type
    const partLinks = await db.part_vehicle_types.findMany({
      where: { vehicle_type_id: vehicleTypeId },
      select: { part_id: true }
    })

    if (partLinks.length === 0) {
      console.log(
        `[getCategoriesByVehicleTypeId] No parts found for vehicle type ${vehicleTypeId}`
      )
      return []
    }

    const partIdList = partLinks.map((p) => p.part_id)

    // Get unique categories with part counts
    const partsWithCategories = await db.parts.findMany({
      where: { id: { in: partIdList } },
      select: {
        category_id: true,
        part_categories: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    // Group by category and count
    const categoryMap = new Map<
      number,
      { id: number; name: string; count: number }
    >()
    partsWithCategories.forEach((p) => {
      const key = p.category_id
      if (categoryMap.has(key)) {
        categoryMap.get(key)!.count++
      } else {
        categoryMap.set(key, {
          id: p.part_categories.id,
          name: p.part_categories.name,
          count: 1
        })
      }
    })

    const categoriesWithCounts = Array.from(categoryMap.values())
      .map((c) => ({
        id: c.id,
        name: c.name,
        partCount: c.count,
        image: null
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    console.log(
      `[getCategoriesByVehicleTypeId] Found ${categoriesWithCounts.length} categories for vehicle type ${vehicleTypeId}`
    )

    return categoriesWithCounts
  } catch (error) {
    console.error('[getCategoriesByVehicleTypeId] Error:', error)
    return []
  }
}

/**
 * Verilen vehicleTypeId ve categoryId için parçaları getirir.
 * Bu fonksiyon db.app schema'sından veri çeker.
 */
export async function getPartsByVehicleTypeAndCategory(
  vehicleTypeId: number,
  categoryId: number,
  limit: number = 50
): Promise<AppPart[]> {
  try {
    // Get part IDs for this vehicle type
    const partLinks = await db.part_vehicle_types.findMany({
      where: { vehicle_type_id: vehicleTypeId },
      select: { part_id: true }
    })

    if (partLinks.length === 0) {
      return []
    }

    const partIdList = partLinks.map((p) => p.part_id)

    // Get parts with brand and category info
    const partsData = await db.parts.findMany({
      where: {
        id: { in: partIdList },
        category_id: categoryId
      },
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        part_brands: { select: { name: true } },
        part_categories: { select: { name: true } },
        part_images: { take: 1, select: { image: true } }
      }
    })

    console.log(
      `[getPartsByVehicleTypeAndCategory] Found ${partsData.length} parts for vehicle type ${vehicleTypeId}, category ${categoryId}`
    )

    return partsData.map((p) => ({
      id: Number(p.id),
      name: p.name,
      brand: p.part_brands.name,
      categoryId: p.category_id,
      categoryName: p.part_categories.name,
      price: p.price?.toString() ?? null,
      image: p.part_images[0]?.image ?? null,
      articleLinkId: Number(p.article_link_id)
    }))
  } catch (error) {
    console.error('[getPartsByVehicleTypeAndCategory] Error:', error)
    return []
  }
}

/**
 * Verilen vehicleTypeId için tüm parçaları getirir (kategoriye göre gruplu değil).
 */
export async function getAllPartsByVehicleTypeId(
  vehicleTypeId: number,
  limit: number = 100
): Promise<AppPart[]> {
  try {
    // Get part IDs for this vehicle type
    const partLinks = await db.part_vehicle_types.findMany({
      where: { vehicle_type_id: vehicleTypeId },
      select: { part_id: true }
    })

    if (partLinks.length === 0) {
      return []
    }

    const partIdList = partLinks.map((p) => p.part_id)

    // Get parts with brand and category info
    const partsData = await db.parts.findMany({
      where: { id: { in: partIdList } },
      take: limit,
      orderBy: [{ part_categories: { name: 'asc' } }, { name: 'asc' }],
      include: {
        part_brands: { select: { name: true } },
        part_categories: { select: { name: true } },
        part_images: { take: 1, select: { image: true } }
      }
    })

    return partsData.map((p) => ({
      id: Number(p.id),
      name: p.name,
      brand: p.part_brands.name,
      categoryId: p.category_id,
      categoryName: p.part_categories.name,
      price: p.price?.toString() ?? null,
      image: p.part_images[0]?.image ?? null,
      articleLinkId: Number(p.article_link_id)
    }))
  } catch (error) {
    console.error('[getAllPartsByVehicleTypeId] Error:', error)
    return []
  }
}
