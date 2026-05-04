import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { SearchHit } from '@/lib/types/search'

export type CatalogSortOption = 'popularity' | 'price-asc' | 'price-desc' | 'name'

export interface ResolvedSupplierCatalogQueryInput {
  categoryName?: string
  searchIds?: number[]
  vehicleId?: number | null
  brandIds?: number[]
  stockStatuses?: Array<'in-stock' | 'on-order'>
  minPrice?: number
  maxPrice?: number
  sort?: CatalogSortOption
  page?: number
  limit?: number
  query?: string
  includeTotal?: boolean
}

export interface ResolvedSupplierCatalogQueryResult {
  hits: SearchHit[]
  total: number | null
}

function buildCategoryNameVariants(categoryName: string): string[] {
  const base = categoryName.trim()
  if (!base) return []

  const values = new Set<string>([base])
  if (base.toLowerCase().endsWith('s')) {
    values.add(base.slice(0, -1))
  } else {
    values.add(`${base}s`)
  }

  return Array.from(values)
}

function normalizeSearchQuery(input: string): {
  raw: string
  compact: string
  isCodeLike: boolean
} {
  const raw = input.trim()
  const compact = raw.replace(/[^0-9a-zA-Z]+/g, '').toUpperCase()
  const isCodeLike = /\d/.test(raw) || /\d/.test(compact)
  return { raw, compact, isCodeLike }
}

function getOrderBy(sort: CatalogSortOption | undefined): any[] {
  switch (sort) {
    case 'price-asc':
      return [{ supplier_products: { supplier_price: 'asc' } }, { id: 'asc' }]
    case 'price-desc':
      return [{ supplier_products: { supplier_price: 'desc' } }, { id: 'desc' }]
    case 'name':
      return [{ supplier_products: { supplier_name: 'asc' } }, { id: 'asc' }]
    case 'popularity':
    default:
      return [{ supplier_products: { updated_at: 'desc' } }, { id: 'desc' }]
  }
}

function resolveMatchType(input: {
  hasDerivedLink: boolean
  isManual: boolean
}): SearchHit['matchType'] {
  if (input.hasDerivedLink) return 'derived_clone'
  if (input.isManual) return 'manual_mapping'
  return 'approved_oem_mapping'
}

export async function fetchResolvedSupplierCatalogHits(
  input: ResolvedSupplierCatalogQueryInput
): Promise<ResolvedSupplierCatalogQueryResult> {
  const sort = input.sort || 'popularity'
  const page = Math.max(1, input.page || 1)
  const limit = Math.max(1, Math.min(96, input.limit || 24))
  const skip = (page - 1) * limit
  const includeTotal = input.includeTotal !== false

  const where: Prisma.supplier_part_mappingsWhereInput = {
    status: 'APPROVED',
    part_id: { not: null }
  }

  const andConditions: Prisma.supplier_part_mappingsWhereInput[] = []
  const partFilters: Prisma.partsWhereInput[] = []

  const searchIds = (input.searchIds || []).filter((id) => Number.isInteger(id) && id > 0)
  if (searchIds.length > 0) {
    partFilters.push({ category_id: { in: searchIds } })
  } else if (input.categoryName) {
    const names = buildCategoryNameVariants(input.categoryName)
    if (names.length > 0) {
      partFilters.push({
        part_categories: {
          OR: [
            { name: { in: names, mode: 'insensitive' } },
            { name_tr: { in: names, mode: 'insensitive' } }
          ]
        }
      })
    }
  }

  if (typeof input.vehicleId === 'number' && Number.isInteger(input.vehicleId)) {
    partFilters.push({
      part_vehicle_types: {
        some: {
          vehicle_type_id: input.vehicleId
        }
      }
    })
  }

  const brandIds = (input.brandIds || []).filter((id) => Number.isInteger(id) && id > 0)
  if (brandIds.length > 0) {
    partFilters.push({
      brand_id: { in: brandIds }
    })
  }

  if (partFilters.length > 0) {
    andConditions.push({
      parts: partFilters.length === 1 ? partFilters[0] : { AND: partFilters }
    })
  }

  const stockStatuses = (input.stockStatuses || []).filter(
    (value): value is 'in-stock' | 'on-order' => value === 'in-stock' || value === 'on-order'
  )

  if (stockStatuses.length === 1) {
    if (stockStatuses[0] === 'in-stock') {
      andConditions.push({
        supplier_products: {
          supplier_stock_qty: {
            gt: 0
          }
        }
      })
    } else {
      andConditions.push({
        supplier_products: {
          supplier_stock_qty: {
            lte: 0
          }
        }
      })
    }
  }

  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    andConditions.push({
      supplier_products: {
        supplier_price: {
          ...(input.minPrice !== undefined
            ? { gte: new Prisma.Decimal(input.minPrice) }
            : {}),
          ...(input.maxPrice !== undefined
            ? { lte: new Prisma.Decimal(input.maxPrice) }
            : {})
        }
      }
    })
  }

  const query = input.query?.trim() || ''
  if (query.length > 0) {
    const normalized = normalizeSearchQuery(query)
    const searchOr: Prisma.supplier_part_mappingsWhereInput[] = [
      {
        supplier_sku: {
          contains: normalized.raw,
          mode: 'insensitive'
        }
      },
      {
        supplier_products: {
          supplier_name: {
            contains: normalized.raw,
            mode: 'insensitive'
          }
        }
      }
    ]

    if (normalized.compact.length >= 3) {
      searchOr.push({
        supplier_products: {
          normalized_sku: {
            contains: normalized.compact,
            mode: 'insensitive'
          }
        }
      })

      searchOr.push({
        supplier_products: {
          supplier_product_oems: {
            some: {
              is_active: true,
              normalized_oem_code: {
                contains: normalized.compact,
                mode: 'insensitive'
              }
            }
          }
        }
      })
    }

    andConditions.push({ OR: searchOr })
  }

  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  const [rows, total] = await Promise.all([
    db.supplier_part_mappings.findMany({
      where,
      orderBy: getOrderBy(sort),
      skip,
      take: limit,
      select: {
        id: true,
        provider_id: true,
        supplier_product_id: true,
        supplier_sku: true,
        part_id: true,
        match_reason: true,
        is_manual: true,
        updated_at: true,
        supplier_providers: {
          select: {
            code: true,
            name: true
          }
        },
        supplier_products: {
          select: {
            id: true,
            supplier_name: true,
            supplier_brand: true,
            supplier_sku: true,
            supplier_price: true,
            supplier_stock_qty: true,
            created_at: true,
            updated_at: true,
            supplier_product_oems: {
              where: {
                is_active: true
              },
              select: {
                oem_code: true
              },
              orderBy: {
                updated_at: 'desc'
              },
              take: 24
            }
          }
        },
        parts: {
          select: {
            id: true,
            name: true,
            article_link_id: true,
            in_basket: true,
            brand_id: true,
            category_id: true,
            created_at: true,
            updated_at: true,
            part_brands: {
              select: {
                name: true,
                logo_url: true
              }
            },
            part_categories: {
              select: {
                name: true,
                name_tr: true
              }
            },
            part_images: {
              select: {
                image: true,
                thumb: true
              },
              take: 2
            },
            part_properties: {
              select: {
                key: true,
                value: true
              },
              take: 4
            },
            part_vehicle_types: {
              select: {
                vehicle_type_id: true
              },
              take: 16
            }
          }
        }
      }
    }),
    includeTotal ? db.supplier_part_mappings.count({ where }) : Promise.resolve(null)
  ])

  const supplierProductIds = Array.from(
    new Set(rows.map((row) => row.supplier_product_id).filter(Boolean))
  )

  const providerIds = Array.from(new Set(rows.map((row) => row.provider_id).filter(Boolean)))

  const resolvedLinks =
    supplierProductIds.length > 0
      ? await db.part_reference_links.findMany({
          where: {
            is_active: true,
            supplier_product_id: { in: supplierProductIds },
            provider_id: { in: providerIds }
          },
          select: {
            provider_id: true,
            supplier_product_id: true,
            derived_part_id: true,
            updated_at: true
          },
          orderBy: {
            updated_at: 'desc'
          }
        })
      : []

  const linkByKey = new Map<string, { derivedPartId: bigint }>()
  for (const link of resolvedLinks) {
    const key = `${link.provider_id}:${link.supplier_product_id}`
    if (!linkByKey.has(key)) {
      linkByKey.set(key, {
        derivedPartId: link.derived_part_id
      })
    }
  }

  const hits: SearchHit[] = rows
    .map<SearchHit | null>((row) => {
      const key = `${row.provider_id}:${row.supplier_product_id}`
      const derived = linkByKey.get(key)
      const resolvedPartId = derived?.derivedPartId || row.part_id

      if (!resolvedPartId || !row.parts) return null

      const supplierPrice = row.supplier_products.supplier_price
      const stockQty = Math.max(0, row.supplier_products.supplier_stock_qty || 0)
      const price = supplierPrice ? supplierPrice.toString() : null
      const isPlaceholderPrice = !price

      const providerCode = row.supplier_providers.code?.toUpperCase() || 'SUPPLIER'
      const supplierSku = row.supplier_sku || row.supplier_products.supplier_sku
      const supplierName =
        row.supplier_products.supplier_name ||
        `${providerCode} ${supplierSku}`.trim()

      return {
        id: resolvedPartId.toString(),
        name: supplierName,
        articleLinkId: row.supplier_products.id.toString(),
        dedupeKey: `supplier:${providerCode}:${row.supplier_product_id}`,
        variantCount: 1,
        price,
        stockQty,
        priceSource: isPlaceholderPrice ? 'placeholder' : 'real',
        isPlaceholderPrice,
        isPurchasable: !isPlaceholderPrice && stockQty > 0,
        inBasket: row.parts.in_basket,
        brandId: row.parts.brand_id,
        brandName: row.parts.part_brands.name,
        brandLogo: row.parts.part_brands.logo_url,
        categoryId: row.parts.category_id,
        categoryName: row.parts.part_categories.name,
        categoryNameTr: row.parts.part_categories.name_tr,
        oemCodes: row.supplier_products.supplier_product_oems.map((item) => item.oem_code),
        oemBrands: [],
        vehicleTypes: [],
        vehicleIds: row.parts.part_vehicle_types.map((item) => item.vehicle_type_id),
        vehicleNames: [],
        formattedCompatibility: [],
        searchableText: [
          supplierName,
          supplierSku,
          providerCode,
          row.parts.name,
          row.parts.part_brands.name,
          row.parts.part_categories.name
        ]
          .filter(Boolean)
          .join(' '),
        images: row.parts.part_images.map((image) => ({
          image: image.image,
          thumb: image.thumb
        })),
        properties: [
          {
            key: 'SUPPLIER_PROVIDER',
            value: providerCode,
            key_tr: null,
            value_tr: null
          },
          {
            key: 'SUPPLIER_SKU',
            value: supplierSku,
            key_tr: null,
            value_tr: null
          },
          ...row.parts.part_properties.map((prop) => ({
            key: prop.key,
            value: prop.value,
            key_tr: null,
            value_tr: null
          }))
        ].slice(0, 8),
        createdAt: row.supplier_products.created_at.toISOString(),
        updatedAt: row.supplier_products.updated_at.toISOString(),
        sourceType: 'supplier_product',
        resolvedPartId: resolvedPartId.toString(),
        supplierProductId: row.supplier_product_id,
        providerCode,
        supplierSku,
        matchType: resolveMatchType({
          hasDerivedLink: Boolean(derived),
          isManual: row.is_manual
        }),
        canonicalKey: `part:${resolvedPartId.toString()}`,
        rankBucket: 2
      } satisfies SearchHit
    })
    .filter((hit): hit is SearchHit => Boolean(hit))

  return {
    hits,
    total
  }
}
