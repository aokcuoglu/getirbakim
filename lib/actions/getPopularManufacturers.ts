'use server'

import { db } from '@/lib/db'

export interface PopularManufacturer {
  id: number
  name: string
  logoUrl: string | null
}

export async function getPopularManufacturers(): Promise<
  PopularManufacturer[]
> {
  const brands = await db.part_brands.findMany({
    where: {
      logo_url: { not: null }
    },
    select: {
      id: true,
      name: true,
      logo_url: true
    },
    orderBy: { name: 'asc' }
  })

  return brands.map((b) => ({
    id: b.id,
    name: b.name,
    logoUrl: b.logo_url
  }))
}
