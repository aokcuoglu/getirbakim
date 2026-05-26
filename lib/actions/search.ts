'use server'

import { db } from '@/lib/db'
import { isV0OnlySite } from '@/lib/v0/siteMode'
import { searchV0Global } from '@/lib/v0/search/v0-search-global'

type ProductRow = {
  id: bigint
  name: string
  price: { toString(): string } | null
  part_brands: { name: string }
  part_categories: { name: string }
}

export type SearchResultCategory = {
  id: number
  name: string
  slug: string
  image: string | null
  type: 'category'
}

export type SearchResultProduct = {
  id: number
  name: string
  brandName: string
  categoryName: string | null
  price: string | null
  image: string | null
  urlKey: string
  type: 'product'
}

export type SearchResultBrand = {
  matchId: number
  brandName: string
  logoUrl: string | null
  slug: string
  type: 'brand'
}

export type SearchResults = {
  categories: SearchResultCategory[]
  products: SearchResultProduct[]
  brands?: SearchResultBrand[]
}

export async function searchGlobal(query: string): Promise<SearchResults> {
  if (!query || query.length < 2) {
    return { categories: [], products: [], brands: [] }
  }

  if (isV0OnlySite()) {
    const v0 = await searchV0Global(query)
    return {
      categories: [],
      products: v0.products,
      brands: v0.brands
    }
  }

  const normalizedQuery = query.trim()
  const compactQuery = normalizedQuery.toLowerCase().replace(/[^0-9a-z]+/g, '')
  const isCodeLikeQuery =
    /[0-9]/.test(normalizedQuery) && compactQuery.replace(/[^0-9]/g, '').length >= 4

  // Run all initial queries in parallel for better performance
  const [
    categoryResults,
    partIdsFromOen,
    partIdsFromEan,
    partIdsFromCrossRef,
    partIdsFromSupplierSku,
    directProductResults
  ]: [
    Array<{ id: number; name: string }>,
    Array<{ part_id: bigint }>,
    Array<{ part_id: bigint }>,
    Array<{ part_id: bigint }>,
    Array<{ part_id: bigint | null }>,
    ProductRow[]
  ] = await Promise.all([
    // 1. Search Categories
    isCodeLikeQuery
      ? Promise.resolve([])
      : db.part_categories.findMany({
          where: {
            name: { contains: normalizedQuery, mode: 'insensitive' }
          },
          select: {
            id: true,
            name: true
          },
          take: 5
        }),

    // 2. Find part IDs from OEN codes
    db.part_oens.findMany({
      where: {
        code: {
          contains: compactQuery.length >= 3 ? compactQuery : normalizedQuery,
          mode: 'insensitive'
        }
      },
      select: { part_id: true },
      distinct: ['part_id'],
      take: 15
    }),

    // 3. Find part IDs from EAN codes
    db.part_eans.findMany({
      where: {
        code: {
          contains: compactQuery.length >= 3 ? compactQuery : normalizedQuery,
          mode: 'insensitive'
        }
      },
      select: { part_id: true },
      distinct: ['part_id'],
      take: 15
    }),

    // 4. Find part IDs from cross-references
    db.part_cross_references.findMany({
      where: {
        article_number: {
          contains: compactQuery.length >= 3 ? compactQuery : normalizedQuery,
          mode: 'insensitive'
        }
      },
      select: { part_id: true },
      distinct: ['part_id'],
      take: 15
    }),

    // 5. Find part IDs from supplier SKU mappings (Dinamik/SETA)
    db.supplier_part_mappings.findMany({
      where: {
        part_id: { not: null },
        status: 'APPROVED',
        OR: [
          {
            supplier_sku: {
              contains: normalizedQuery,
              mode: 'insensitive' as const
            }
          },
          ...(compactQuery.length >= 3
            ? [
                {
                  supplier_products: {
                    normalized_sku: {
                      contains: compactQuery,
                      mode: 'insensitive' as const
                    }
                  }
                }
              ]
            : [])
        ]
      },
      select: { part_id: true },
      distinct: ['part_id'],
      take: 15
    }),

    // 6. Direct product search
    db.parts.findMany({
      where: isCodeLikeQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery, mode: 'insensitive' } },
              ...(compactQuery.length >= 3
                ? [
                    {
                      name: {
                        contains: compactQuery,
                        mode: 'insensitive' as const
                      }
                    }
                  ]
                : [])
            ]
          }
        : {
            OR: [
              { name: { contains: normalizedQuery, mode: 'insensitive' } },
              {
                part_brands: {
                  name: { contains: normalizedQuery, mode: 'insensitive' }
                }
              },
              {
                part_categories: {
                  name: { contains: normalizedQuery, mode: 'insensitive' }
                }
              }
            ]
          },
      select: {
        id: true,
        name: true,
        price: true,
        part_brands: { select: { name: true } },
        part_categories: { select: { name: true } }
      },
      take: 10
    })
  ])

  // Combine related part IDs and fetch additional products if needed
  const relatedPartIds = [
    ...partIdsFromOen.map((r) => r.part_id),
    ...partIdsFromEan.map((r) => r.part_id),
    ...partIdsFromCrossRef.map((r) => r.part_id),
    ...partIdsFromSupplierSku
      .map((r) => r.part_id)
      .filter((id): id is bigint => id !== null)
  ]
  const uniqueRelatedPartIds = Array.from(new Set(relatedPartIds))

  // Get existing IDs from direct search
  const existingIds = new Set(directProductResults.map((p) => p.id))

  // Filter out IDs we already have
  const additionalIds = uniqueRelatedPartIds.filter(
    (id) => !existingIds.has(id)
  )

  // Fetch additional products from OEN/cross-ref matches (if any)
  let additionalProducts: ProductRow[] = []
  if (additionalIds.length > 0) {
    additionalProducts = await db.parts.findMany({
      where: { id: { in: additionalIds.slice(0, 5) } },
      select: {
        id: true,
        name: true,
        price: true,
        part_brands: { select: { name: true } },
        part_categories: { select: { name: true } }
      },
      take: 5
    })
  }

  // Combine all products
  const allProducts = [...directProductResults, ...additionalProducts].slice(
    0,
    12
  )

  // Fetch images in parallel with results processing
  const productIds = allProducts.map((p) => p.id)
  const imageMap = new Map<bigint, string>()

  if (productIds.length > 0) {
    const images = await db.part_images.findMany({
      where: { part_id: { in: productIds } },
      select: {
        part_id: true,
        thumb: true
      }
    })

    images.forEach((img) => {
      if (!imageMap.has(img.part_id) && img.thumb) {
        imageMap.set(img.part_id, img.thumb)
      }
    })
  }

  // Helper to generate slug from name
  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[şŞ]/g, 's')
      .replace(/[ğĞ]/g, 'g')
      .replace(/[üÜ]/g, 'u')
      .replace(/[öÖ]/g, 'o')
      .replace(/[çÇ]/g, 'c')
      .replace(/[ıİ]/g, 'i')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  // Map results
  const mappedCategories: SearchResultCategory[] = categoryResults.map(
    (cat) => ({
      id: cat.id,
      name: cat.name,
      slug: `${generateSlug(cat.name)}-${cat.id}`,
      image: null,
      type: 'category'
    })
  )

  const mappedProducts: SearchResultProduct[] = allProducts.map((p) => ({
    id: Number(p.id),
    name: p.name,
    brandName: p.part_brands.name,
    categoryName: p.part_categories.name,
    price: p.price?.toString() ?? null,
    image: imageMap.get(p.id) || null,
    urlKey: p.id.toString(),
    type: 'product'
  }))

  return {
    categories: mappedCategories,
    products: mappedProducts,
    brands: []
  }
}
