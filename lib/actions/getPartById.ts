'use server'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { getFromCache, setCache } from '@/lib/redis'
import { getMeiliClient, isMeiliNoRouteError, PARTS_INDEX } from '@/lib/meilisearch'
import {
  decimalToString,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from '@/lib/pricing/public-pricing'
import { getCategoryMinRealPriceMap } from '@/lib/pricing/public-pricing-db'

// Part detail response type
export interface PartDetail {
  id: number
  name: string
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  brand: {
    id: number
    name: string
    logoUrl: string | null
  }
  category: {
    id: number
    name: string
    urlKey: string
  }
  images: {
    image: string | null
    thumb: string | null
  }[]
  properties: {
    key: string
    value: string
  }[]
  infos: string[]
  eans: string[]
  oens: {
    brand: string
    code: string
  }[]
  crossReferences: {
    brandName: string
    articleNumber: string
    supplierProductId?: number | null
    partId?: number | null
  }[]
  compatibleVehicles: {
    id: number
    brandName: string
    modelName: string
    vehicleName: string
    typeName: string
    yearFrom: string | null
    yearTo: string | null
  }[]
}

// Lightweight subset for SEO metadata (no pricing logic or vehicle joins)
export interface PartMetadata {
  id: number
  name: string
  brandName: string
  categoryName: string
  imageUrl: string | null
  eans: string[]
}

// Lightweight subset for initial product page render (critical hero only)
export interface PartHero {
  id: number
  name: string
  articleNumber: string | null
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  brand: {
    id: number
    name: string
    logoUrl: string | null
  }
  category: {
    id: number
    name: string
    urlKey: string
  }
  images: {
    image: string | null
    thumb: string | null
  }[]
  properties: {
    key: string
    value: string
  }[]
  eans: string[]
}

export interface PartTabsData {
  properties: { key: string; value: string }[]
  infos: string[]
  oens: { brand: string; code: string }[]
  crossReferences: {
    brandName: string
    articleNumber: string
    supplierProductId?: number | null
    partId?: number | null
  }[]
  compatibleVehicles: {
    id: number
    brandName: string
    modelName: string
    vehicleName: string
    typeName: string
    yearFrom: string | null
    yearTo: string | null
  }[]
}

type CrossReferenceRow = {
  brandName: string
  articleNumber: string
  supplierProductId?: number | null
  partId?: number | null
}

function normalizeCrossReferenceToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

function normalizeCrossReferenceBrandToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

function mergeCrossReferences(
  baseRows: CrossReferenceRow[],
  supplierRows: CrossReferenceRow[]
): CrossReferenceRow[] {
  const mergedByKey = new Map<string, CrossReferenceRow>()

  for (const row of [...baseRows, ...supplierRows]) {
    const brandName = row.brandName?.trim()
    const articleNumber = row.articleNumber?.trim()
    if (!brandName || !articleNumber) continue

    const key = `${normalizeCrossReferenceToken(brandName)}::${normalizeCrossReferenceToken(articleNumber)}`
    const existing = mergedByKey.get(key)

    if (!existing) {
      mergedByKey.set(key, {
        brandName,
        articleNumber,
        supplierProductId: row.supplierProductId ?? null,
        partId: row.partId ?? null
      })
      continue
    }

    // Prefer the row that carries supplier product linkage for clickable detail.
    if (!existing.supplierProductId && row.supplierProductId) {
      mergedByKey.set(key, {
        brandName,
        articleNumber,
        supplierProductId: row.supplierProductId,
        partId: existing.partId ?? row.partId ?? null
      })
      continue
    }

    if (!existing.partId && row.partId) {
      mergedByKey.set(key, {
        brandName,
        articleNumber,
        supplierProductId: existing.supplierProductId ?? null,
        partId: row.partId
      })
    }
  }

  return Array.from(mergedByKey.values())
}

async function attachPartIdsToCrossReferences(
  currentPartId: number,
  rows: CrossReferenceRow[]
): Promise<CrossReferenceRow[]> {
  const pairMap = new Map<
    string,
    {
      brandToken: string
      articleToken: string
    }
  >()

  for (const row of rows) {
    const brandToken = normalizeCrossReferenceBrandToken(row.brandName)
    const articleToken = normalizeCrossReferenceToken(row.articleNumber)
    if (!brandToken || !articleToken) continue
    pairMap.set(`${brandToken}::${articleToken}`, { brandToken, articleToken })
  }

  const pairs = Array.from(pairMap.values())

  if (pairs.length === 0) return rows

  const inputPairsSql = Prisma.join(
    pairs.map((pair) => Prisma.sql`(${pair.brandToken}, ${pair.articleToken})`)
  )
  const candidates = await db.$queryRaw<
    Array<{
      source: string
      brand_token: string
      article_token: string
      part_id: string
    }>
  >(Prisma.sql`
    WITH input_pairs(brand_token, article_token) AS (
      VALUES ${inputPairsSql}
    ),
    matched AS (
      SELECT DISTINCT
        'name_brand'::text AS source,
        ip.brand_token,
        ip.article_token,
        p.id::text AS part_id
      FROM input_pairs ip
      JOIN parts p
        ON regexp_replace(upper(p.name), '[^A-Z0-9]+', '', 'g') = ip.article_token
      JOIN part_brands pb
        ON pb.id = p.brand_id
       AND regexp_replace(upper(pb.name), '[^A-Z0-9]+', '', 'g') = ip.brand_token
      UNION
      SELECT DISTINCT
        'part_no_brand'::text AS source,
        ip.brand_token,
        ip.article_token,
        p.id::text AS part_id
      FROM input_pairs ip
      JOIN parts p
        ON regexp_replace(upper(CAST(p.part_no AS TEXT)), '[^A-Z0-9]+', '', 'g') = ip.article_token
      JOIN part_brands pb
        ON pb.id = p.brand_id
       AND regexp_replace(upper(pb.name), '[^A-Z0-9]+', '', 'g') = ip.brand_token
      UNION
      SELECT DISTINCT
        'name_only'::text AS source,
        ip.brand_token,
        ip.article_token,
        p.id::text AS part_id
      FROM input_pairs ip
      JOIN parts p
        ON regexp_replace(upper(p.name), '[^A-Z0-9]+', '', 'g') = ip.article_token
      UNION
      SELECT DISTINCT
        'cross_brand'::text AS source,
        regexp_replace(upper(pcr.brand_name), '[^A-Z0-9]+', '', 'g') AS brand_token,
        regexp_replace(upper(pcr.article_number), '[^A-Z0-9]+', '', 'g') AS article_token,
        pcr.part_id::text AS part_id
      FROM part_cross_references pcr
      JOIN input_pairs ip
        ON regexp_replace(upper(pcr.brand_name), '[^A-Z0-9]+', '', 'g') = ip.brand_token
       AND regexp_replace(upper(pcr.article_number), '[^A-Z0-9]+', '', 'g') = ip.article_token
    )
    SELECT source, brand_token, article_token, part_id
    FROM matched
  `)

  const byPairAndSource = new Map<string, Map<string, Set<number>>>()
  for (const candidate of candidates) {
    const source = candidate.source || ''
    const brandToken = candidate.brand_token || ''
    const articleToken = candidate.article_token || ''
    const partId = Number(candidate.part_id)
    if (!source || !brandToken || !articleToken || !Number.isInteger(partId) || partId <= 0) continue
    const key = `${brandToken}::${articleToken}`
    if (!byPairAndSource.has(key)) byPairAndSource.set(key, new Map())
    const sourceMap = byPairAndSource.get(key)!
    if (!sourceMap.has(source)) sourceMap.set(source, new Set())
    sourceMap.get(source)!.add(partId)
  }

  const resolveFromSet = (values: Set<number> | undefined): number | null => {
    if (!values || values.size === 0) return null
    const unique = Array.from(values).filter((id) => id !== currentPartId)
    if (unique.length === 1) return unique[0]
    return null
  }

  return rows.map((row) => {
    if (row.partId) return row

    const brandToken = normalizeCrossReferenceBrandToken(row.brandName)
    const articleToken = normalizeCrossReferenceToken(row.articleNumber)
    const sourceMap = byPairAndSource.get(`${brandToken}::${articleToken}`)
    if (!sourceMap) return { ...row, partId: null }

    const partId =
      resolveFromSet(sourceMap.get('name_brand')) ??
      resolveFromSet(sourceMap.get('part_no_brand')) ??
      resolveFromSet(sourceMap.get('name_only')) ??
      resolveFromSet(sourceMap.get('cross_brand'))

    return { ...row, partId }
  })
}

async function fetchSupplierCrossReferencesForPart(
  partId: number
): Promise<CrossReferenceRow[]> {
  const rows = await db.supplier_part_mappings.findMany({
    where: {
      part_id: BigInt(partId),
      status: 'APPROVED'
    },
    select: {
      supplier_product_id: true,
      supplier_sku: true,
      supplier_providers: {
        select: {
          code: true,
          name: true
        }
      },
      supplier_products: {
        select: {
          supplier_sku: true
        }
      }
    },
    orderBy: [{ updated_at: 'desc' }],
    take: 200
  })

  return rows
    .map((row) => {
      const articleNumber =
        row.supplier_sku?.trim() || row.supplier_products.supplier_sku?.trim() || ''
      const providerCode = row.supplier_providers.code?.trim()
      const providerName = row.supplier_providers.name?.trim()
      const brandName =
        (providerCode ? providerCode.toUpperCase() : providerName) || 'SUPPLIER'

      return {
        brandName,
        articleNumber,
        supplierProductId: row.supplier_product_id
      }
    })
    .filter((row) => row.articleNumber.length > 0)
}

async function resolveVariantPartGroupIds(partId: number): Promise<bigint[]> {
  const targetPart = await db.parts.findFirst({
    where: { id: BigInt(partId) },
    select: {
      id: true,
      tecdoc_article_id: true
    }
  })

  if (!targetPart) return []

  // Use a single stable anchor to avoid recursive/explosive sibling expansion.
  // If tecdoc_article_id exists, all variants should share that anchor.
  // Otherwise fall back to current part id.
  const anchorId = targetPart.tecdoc_article_id ?? targetPart.id
  const siblingParts = await db.parts.findMany({
    where: {
      OR: [
        { id: anchorId },
        { tecdoc_article_id: anchorId }
      ]
    },
    select: {
      id: true
    }
  })

  const groupIds = new Set<bigint>([targetPart.id, ...siblingParts.map((s) => s.id)])
  return Array.from(groupIds)
}

async function fetchMappedSupplierOems(
  partId: number
): Promise<Array<{ brand: string; code: string }>> {
  type OemRow = { oem_code: string; provider_code: string }
  const rows = await db.$queryRaw<OemRow[]>(Prisma.sql`
    SELECT spo.oem_code, sp2.code AS provider_code
    FROM supplier_product_oems spo
    JOIN supplier_part_mappings spm ON spm.supplier_product_id = spo.supplier_product_id
    JOIN supplier_providers sp2 ON sp2.id = spm.provider_id
    WHERE spm.part_id = ${BigInt(partId)}
      AND spm.status = 'APPROVED'
      AND spo.is_active = TRUE
      AND length(spo.oem_code) >= 5
    LIMIT 500
  `)

  return rows
    .filter((row) => row.oem_code && row.provider_code)
    .map((row) => ({
      brand: row.provider_code.toUpperCase(),
      code: row.oem_code
    }))
}

async function fetchCompatibleVehiclesForPartGroup(partId: number) {
  const variantPartIds = await resolveVariantPartGroupIds(partId)
  if (variantPartIds.length === 0) return []

  const rows = await db.$queryRaw<
    Array<{
      id: number
      type_name: string
      year_from: string | null
      year_to: string | null
      model_name: string | null
      model_date_from: string | null
      brand_name: string | null
    }>
  >(
    Prisma.sql`
      SELECT DISTINCT
        vt.id,
        vt.name AS type_name,
        vt.year_of_constr_from AS year_from,
        vt.year_of_constr_to AS year_to,
        vm.name AS model_name,
        vm.date_from AS model_date_from,
        vb.name AS brand_name
      FROM part_vehicle_types pvt
      JOIN vehicle_types vt ON vt.id = pvt.vehicle_type_id
      LEFT JOIN vehicle_models vm ON vm.id = vt.model_id
      LEFT JOIN vehicle_brands vb ON vb.id = vm.brand_id
      WHERE pvt.part_id IN (${Prisma.join(variantPartIds)})
      ORDER BY vt.id DESC
      LIMIT 300
    `
  )

  return rows
    .filter((row) => Boolean(row.model_name) && Boolean(row.brand_name))
    .map((row) => ({
      id: row.id,
      brandName: row.brand_name as string,
      modelName: row.model_name as string,
      vehicleName: `${row.model_name as string} (${row.model_date_from || ''})`,
      typeName: row.type_name,
      yearFrom: row.year_from,
      yearTo: row.year_to
    }))
}

/**
 * Internal function to fetch part detail without cache
 */
async function fetchPartById(partId: number): Promise<PartDetail | null> {
  try {
    // Fetch part with optimized select
    const part = await db.parts.findFirst({
      where: { id: BigInt(partId) },
      select: {
        id: true,
        tecdoc_article_id: true,
        category_id: true,
        name: true,
        price: true,
        part_pricing_inventory: {
          select: {
            supplier_price: true,
            computed_selling_price_ex_vat: true,
            supplier_stock_qty: true,
            reserved_stock_qty: true
          }
        },
        part_admin_overrides: {
          select: {
            lock_price: true,
            selling_price_override: true
          }
        },
        part_brands: {
          select: {
            id: true,
            name: true,
            logo_url: true
          }
        },
        part_categories: {
          select: {
            id: true,
            name: true
          }
        },
        part_images: {
          select: {
            image: true,
            thumb: true
          }
        },
        part_properties: {
          select: {
            key: true,
            value: true
          }
        },
        part_infos: {
          select: {
            content: true
          }
        },
        part_eans: {
          select: {
            code: true
          }
        },
        part_oens: {
          select: {
            brand: true,
            code: true
          }
        },
        part_cross_references: {
          select: {
            brand_name: true,
            article_number: true
          }
        }
      }
    })

    if (!part) {
      return null
    }

    let fallbackRealPriceExVat: Prisma.Decimal | null = null

    // Fallback: If this variant has no price, try sibling records for same article
    // (either tecdoc_article_id linkage or direct id match to tecdoc id)
    if (!resolveRealPriceExVat(part) && part.tecdoc_article_id != null) {
      const siblingParts = await db.parts.findMany({
        where: {
          AND: [
            {
              OR: [
                { tecdoc_article_id: part.tecdoc_article_id },
                { id: part.tecdoc_article_id }
              ]
            },
            {
              OR: [
                {
                  part_admin_overrides: {
                    is: {
                      lock_price: true,
                      selling_price_override: { not: null }
                    }
                  }
                },
                {
                  part_pricing_inventory: {
                    is: {
                      computed_selling_price_ex_vat: { not: null }
                    }
                  }
                },
                {
                  part_pricing_inventory: {
                    is: {
                      supplier_price: { not: null }
                    }
                  }
                },
                { price: { not: null } }
              ]
            }
          ]
        },
        select: {
          id: true,
          tecdoc_article_id: true,
          price: true,
          part_pricing_inventory: {
            select: {
              supplier_price: true,
              computed_selling_price_ex_vat: true
            }
          },
          part_admin_overrides: {
            select: {
              lock_price: true,
              selling_price_override: true
            }
          }
        },
        orderBy: [{ updated_at: 'desc' }],
        take: 20
      })

      for (const sibling of siblingParts) {
        const candidate = resolveRealPriceExVat(sibling)
        if (candidate) {
          fallbackRealPriceExVat = candidate
          break
        }
      }
    }

    const categoryMinPriceMap = await getCategoryMinRealPriceMap([
      part.category_id
    ])
    const pricing = resolvePublicPriceAndPurchasability({
      realPriceExVat: resolveRealPriceExVat(part) ?? fallbackRealPriceExVat,
      categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id),
      stockQty: part.part_pricing_inventory?.supplier_stock_qty ?? 0,
      reservedStockQty: part.part_pricing_inventory?.reserved_stock_qty ?? 0
    })

    const [compatibleVehicles, supplierCrossReferences, supplierOems] = await Promise.all([
      fetchCompatibleVehiclesForPartGroup(partId),
      fetchSupplierCrossReferencesForPart(partId),
      fetchMappedSupplierOems(partId)
    ])

    const mergedCrossReferences = mergeCrossReferences(
      part.part_cross_references.map((cr) => ({
        brandName: cr.brand_name,
        articleNumber: cr.article_number
      })),
      supplierCrossReferences
    )
    const resolvedCrossReferences = await attachPartIdsToCrossReferences(
      partId,
      mergedCrossReferences
    )

    // Merge catalog OEMs with supplier OEMs; catalog takes precedence on duplicates
    const catalogOens = part.part_oens.map((oen) => ({
      brand: oen.brand,
      code: oen.code
    }))
    const catalogOenKeys = new Set(
      catalogOens.map((oen) => oen.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ''))
    )
    const extraSupplierOems = supplierOems.filter(
      (oen) =>
        !catalogOenKeys.has(oen.code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, ''))
    )
    const mergedOens = [...catalogOens, ...extraSupplierOems]

    return {
      id: Number(part.id),
      name: part.name,
      price: decimalToString(pricing.resolvedPriceExVat),
      stockQty: pricing.stockQty,
      priceSource: pricing.priceSource,
      isPlaceholderPrice: pricing.isPlaceholderPrice,
      isPurchasable: pricing.isPurchasable,
      brand: {
        id: part.part_brands.id,
        name: part.part_brands.name,
        logoUrl: part.part_brands.logo_url
      },
      category: {
        id: part.part_categories.id,
        name: part.part_categories.name,
        urlKey: `${part.part_categories.name
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
          .trim()}-${part.part_categories.id}`
      },
      images: part.part_images.map((img) => ({
        image: img.image,
        thumb: img.thumb
      })),
      properties: part.part_properties.map((prop) => ({
        key: prop.key,
        value: prop.value
      })),
      infos: part.part_infos.map((info) => info.content),
      eans: part.part_eans.map((ean) => ean.code),
      oens: mergedOens,
      crossReferences: resolvedCrossReferences,
      compatibleVehicles
    }
  } catch (error) {
    console.error('Error fetching part by ID:', error)
    return null
  }
}

/**
 * Internal function to fetch "hero" data only (no compatibleVehicles / cross refs)
 */
async function fetchPartHeroById(partId: number): Promise<PartHero | null> {
  try {
    const part = await db.parts.findFirst({
      where: { id: BigInt(partId) },
      select: {
        id: true,
        tecdoc_article_id: true,
        category_id: true,
        name: true,
        price: true,
        part_pricing_inventory: {
          select: {
            supplier_price: true,
            computed_selling_price_ex_vat: true,
            supplier_stock_qty: true,
            reserved_stock_qty: true
          }
        },
        part_admin_overrides: {
          select: {
            lock_price: true,
            selling_price_override: true
          }
        },
        part_brands: {
          select: {
            id: true,
            name: true,
            logo_url: true
          }
        },
        part_categories: {
          select: {
            id: true,
            name: true
          }
        },
        part_images: {
          select: {
            image: true,
            thumb: true
          },
          take: 8
        },
        part_properties: {
          select: {
            key: true,
            value: true
          }
        },
        part_eans: {
          select: {
            code: true
          }
        },
        supplier_part_mappings: {
          where: { status: 'APPROVED' },
          select: { supplier_sku: true },
          take: 1
        }
      }
    })

    if (!part) {
      return null
    }

    // Parallel: fetch fallback price (if needed) and category min price
    const needsFallbackPrice = !resolveRealPriceExVat(part) && part.tecdoc_article_id != null

    const [fallbackRealPriceExVat, categoryMinPriceMap] = await Promise.all([
      needsFallbackPrice
        ? db.parts.findFirst({
            where: {
              AND: [
                {
                  OR: [
                    { tecdoc_article_id: part.tecdoc_article_id! },
                    { id: part.tecdoc_article_id! }
                  ]
                },
                { id: { not: BigInt(partId) } },
                {
                  OR: [
                    {
                      part_admin_overrides: {
                        is: { lock_price: true, selling_price_override: { not: null } }
                      }
                    },
                    {
                      part_pricing_inventory: {
                        is: { computed_selling_price_ex_vat: { not: null } }
                      }
                    },
                    {
                      part_pricing_inventory: {
                        is: { supplier_price: { not: null } }
                      }
                    },
                    { price: { not: null } }
                  ]
                }
              ]
            },
            select: {
              id: true,
              tecdoc_article_id: true,
              price: true,
              part_pricing_inventory: {
                select: { supplier_price: true, computed_selling_price_ex_vat: true }
              },
              part_admin_overrides: {
                select: { lock_price: true, selling_price_override: true }
              }
            },
            orderBy: [{ updated_at: 'desc' }]
          }).then(sibling => sibling ? resolveRealPriceExVat(sibling) : null)
        : Promise.resolve(null),
      getCategoryMinRealPriceMap([part.category_id])
    ])

    const pricing = resolvePublicPriceAndPurchasability({
      realPriceExVat: resolveRealPriceExVat(part) ?? fallbackRealPriceExVat,
      categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id),
      stockQty: part.part_pricing_inventory?.supplier_stock_qty ?? 0,
      reservedStockQty: part.part_pricing_inventory?.reserved_stock_qty ?? 0
    })

    const supplierMapping = part.supplier_part_mappings?.[0] ?? null

    return {
      id: Number(part.id),
      name: part.name,
      articleNumber: supplierMapping?.supplier_sku ?? null,
      price: decimalToString(pricing.resolvedPriceExVat),
      stockQty: pricing.stockQty,
      priceSource: pricing.priceSource,
      isPlaceholderPrice: pricing.isPlaceholderPrice,
      isPurchasable: pricing.isPurchasable,
      brand: {
        id: part.part_brands.id,
        name: part.part_brands.name,
        logoUrl: part.part_brands.logo_url
      },
      category: {
        id: part.part_categories.id,
        name: part.part_categories.name,
        urlKey: `${part.part_categories.name
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
          .trim()}-${part.part_categories.id}`
      },
      images: part.part_images.map((img) => ({
        image: img.image,
        thumb: img.thumb
      })),
      properties: part.part_properties.map((prop) => ({
        key: prop.key,
        value: prop.value
      })),
      eans: part.part_eans.map((ean) => ean.code)
    }
  } catch (error) {
    console.error('Error fetching part hero by ID:', error)
    return null
  }
}

async function fetchPartTabsDataById(partId: number): Promise<PartTabsData | null> {
  try {
    const [part, compatibleVehicles, supplierCrossReferences] = await Promise.all([
      db.parts.findFirst({
        where: { id: BigInt(partId) },
        select: {
          id: true,
          part_properties: {
            select: { key: true, value: true }
          },
          part_infos: {
            select: { content: true }
          },
          part_oens: {
            select: { brand: true, code: true }
          },
          part_cross_references: {
            select: { brand_name: true, article_number: true }
          }
        }
      }),
      fetchCompatibleVehiclesForPartGroup(partId),
      fetchSupplierCrossReferencesForPart(partId)
    ])

    if (!part) return null

    const mergedCrossReferences = mergeCrossReferences(
      part.part_cross_references.map((cr) => ({
        brandName: cr.brand_name,
        articleNumber: cr.article_number
      })),
      supplierCrossReferences
    )
    const resolvedCrossReferences = await attachPartIdsToCrossReferences(
      partId,
      mergedCrossReferences
    )

    return {
      properties: part.part_properties.map((p) => ({ key: p.key, value: p.value })),
      infos: part.part_infos.map((i) => i.content),
      oens: part.part_oens.map((o) => ({ brand: o.brand, code: o.code })),
      crossReferences: resolvedCrossReferences,
      compatibleVehicles
    }
  } catch (error) {
    console.error('Error fetching part tabs data by ID:', error)
    return null
  }
}

/**
 * Internal function to fetch lightweight metadata for SEO without heavy joins
 */
async function fetchPartMetadataById(
  partId: number
): Promise<PartMetadata | null> {
  try {
    const part = await db.parts.findFirst({
      where: { id: BigInt(partId) },
      select: {
        id: true,
        name: true,
        part_brands: {
          select: {
            name: true
          }
        },
        part_categories: {
          select: {
            name: true
          }
        },
        part_images: {
          select: {
            image: true
          },
          take: 1
        },
        part_eans: {
          select: {
            code: true
          }
        }
      }
    })

    if (!part) {
      return null
    }

    return {
      id: Number(part.id),
      name: part.name,
      brandName: part.part_brands.name,
      categoryName: part.part_categories.name,
      imageUrl: part.part_images[0]?.image ?? null,
      eans: part.part_eans.map((ean) => ean.code)
    }
  } catch (error) {
    console.error('Error fetching part metadata by ID:', error)
    return null
  }
}

/**
 * Cached version of getPartById using Redis
 * 
 * During ISR/static generation, Redis is automatically skipped by getFromCache/setCache
 * to avoid "no-store fetch" errors. Only Next.js unstable_cache is used during build time.
 */
export const getPartById = async (
  partId: number
): Promise<PartDetail | null> => {
  const cacheKey = `part-detail-v6-${partId}`

  try {
    // Try Redis first (automatically skipped during ISR/static generation)
    const cached = await getFromCache<PartDetail>(cacheKey)
    if (cached) {
      return cached
    }

    // Use Next.js unstable_cache (filesystem) - this is ISR-safe and works during build
    const part = await unstable_cache(
      async (id: number) => {
        try {
          return await fetchPartById(id)
        } catch (error) {
          console.error(`Error fetching part ${id}:`, error)
          return null
        }
      },
      ['part-detail-v6', String(partId)],
      {
        revalidate: 3600,
        tags: ['parts']
      }
    )(partId)

    // Cache in Redis if found (automatically skipped during ISR/static generation)
    // Non-blocking - fire and forget
    if (part) {
      setCache(cacheKey, part, 3600).catch(() => {
        // Silently ignore Redis errors - they're non-fatal
      })
    }

    return part
  } catch (error) {
    console.error(`Error in getPartById for part ${partId}:`, error)
    // Try to fetch directly without cache as fallback
    try {
      return await fetchPartById(partId)
    } catch (fallbackError) {
      console.error(`Fallback fetch also failed for part ${partId}:`, fallbackError)
      return null
    }
  }
}

/**
 * Cached lightweight metadata fetch for SEO (used by generateMetadata)
 */
export const getPartMetadataById = async (
  partId: number
): Promise<PartMetadata | null> => {
  const cacheKey = `part-metadata-v1-${partId}`

  try {
    const cached = await getFromCache<PartMetadata>(cacheKey)
    if (cached) {
      return cached
    }

    const part = await unstable_cache(
      async (id: number) => {
        try {
          return await fetchPartMetadataById(id)
        } catch (error) {
          console.error(`Error fetching part metadata ${id}:`, error)
          return null
        }
      },
      ['part-metadata-v1', String(partId)],
      {
        revalidate: 3600,
        tags: ['parts']
      }
    )(partId)

    if (part) {
      setCache(cacheKey, part, 3600).catch(() => {
        // Non-fatal Redis errors
      })
    }

    return part
  } catch (error) {
    console.error(`Error in getPartMetadataById for part ${partId}:`, error)
    try {
      return await fetchPartMetadataById(partId)
    } catch (fallbackError) {
      console.error(
        `Fallback metadata fetch also failed for part ${partId}:`,
        fallbackError
      )
      return null
    }
  }
}

/**
 * Cached lightweight hero fetch for initial render
 */
export const getPartHeroById = async (
  partId: number
): Promise<PartHero | null> => {
  const cacheKey = `part-hero-v2-${partId}`

  try {
    const cached = await getFromCache<PartHero>(cacheKey)
    if (cached) return cached

    const part = await unstable_cache(
      async (id: number) => {
        try {
          return await fetchPartHeroById(id)
        } catch (error) {
          console.error(`Error fetching part hero ${id}:`, error)
          return null
        }
      },
      ['part-hero-v2', String(partId)],
      {
        revalidate: 3600,
        tags: ['parts']
      }
    )(partId)

    if (part) {
      setCache(cacheKey, part, 3600).catch(() => {
        // Non-fatal Redis errors
      })
    }

    return part
  } catch (error) {
    console.error(`Error in getPartHeroById for part ${partId}:`, error)
    try {
      return await fetchPartHeroById(partId)
    } catch (fallbackError) {
      console.error(`Fallback hero fetch failed for part ${partId}:`, fallbackError)
      return null
    }
  }
}

/**
 * Cached tabs data fetch (used by client to lazy-load heavy sections)
 */
export const getPartTabsDataById = async (
  partId: number
): Promise<PartTabsData | null> => {
  const cacheKey = `part-tabs-v6-${partId}`

  try {
    const cached = await getFromCache<PartTabsData>(cacheKey)
    if (cached) return cached

    const data = await unstable_cache(
      async (id: number) => {
        try {
          return await fetchPartTabsDataById(id)
        } catch (error) {
          console.error(`Error fetching tabs data for part ${id}:`, error)
          return null
        }
      },
      ['part-tabs-v6', String(partId)],
      { revalidate: 3600, tags: ['parts'] }
    )(partId)

    if (!data) {
      // Recover from cached null/empty entries by doing a direct read once.
      return await fetchPartTabsDataById(partId)
    }

    if (data) {
      setCache(cacheKey, data, 3600).catch(() => {
        // Non-fatal Redis errors
      })
    }

    return data
  } catch (error) {
    console.error(`Error in getPartTabsDataById for part ${partId}:`, error)
    try {
      return await fetchPartTabsDataById(partId)
    } catch (fallbackError) {
      console.error(
        `Fallback tabs data fetch failed for part ${partId}:`,
        fallbackError
      )
      return null
    }
  }
}

type RelatedPart = {
  id: number
  name: string
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  brandName: string
  brandLogo: string | null
  image: string | null
  thumb: string | null
  properties: { key: string; value: string }[]
  eans: string[]
  isVehicleSpecific: boolean
  isBestseller: boolean
}

type RelatedPartSeed = Omit<
  RelatedPart,
  'price' | 'stockQty' | 'priceSource' | 'isPlaceholderPrice' | 'isPurchasable'
> & {
  price: string | null
  categoryId: number
}

function parseDecimalOrNull(value: string | null | undefined): Prisma.Decimal | null {
  if (!value) return null
  try {
    return new Prisma.Decimal(value)
  } catch {
    return null
  }
}

async function enrichRelatedPartsWithPublicPricing(
  seeds: RelatedPartSeed[]
): Promise<RelatedPart[]> {
  if (seeds.length === 0) return []

  const ids = Array.from(new Set(seeds.map((seed) => seed.id)))
  const dbParts = await db.parts.findMany({
    where: {
      id: {
        in: ids.map((id) => BigInt(id))
      }
    },
    select: {
      id: true,
      category_id: true,
      price: true,
      part_pricing_inventory: {
        select: {
          supplier_price: true,
          computed_selling_price_ex_vat: true,
          supplier_stock_qty: true,
          reserved_stock_qty: true
        }
      },
      part_admin_overrides: {
        select: {
          lock_price: true,
          selling_price_override: true
        }
      }
    }
  })

  const dbPartById = new Map(dbParts.map((part) => [Number(part.id), part]))
  const categoryMinPriceMap = await getCategoryMinRealPriceMap(
    Array.from(
      new Set(seeds.map((seed) => dbPartById.get(seed.id)?.category_id ?? seed.categoryId))
    )
  )

  return seeds.map((seed) => {
    const dbPart = dbPartById.get(seed.id)
    const seededRealPrice = parseDecimalOrNull(seed.price)
    const realPriceExVat = dbPart
      ? resolveRealPriceExVat(dbPart)
      : seededRealPrice
    const categoryIdForPlaceholder = dbPart?.category_id ?? seed.categoryId
    const pricing = resolvePublicPriceAndPurchasability({
      realPriceExVat,
      categoryMinRealPriceExVat: categoryMinPriceMap.get(categoryIdForPlaceholder),
      stockQty: dbPart?.part_pricing_inventory?.supplier_stock_qty ?? 0,
      reservedStockQty: dbPart?.part_pricing_inventory?.reserved_stock_qty ?? 0
    })

    return {
      ...seed,
      price: decimalToString(pricing.resolvedPriceExVat),
      stockQty: pricing.stockQty,
      priceSource: pricing.priceSource,
      isPlaceholderPrice: pricing.isPlaceholderPrice,
      isPurchasable: pricing.isPurchasable
    }
  })
}

/**
 * Fetch related parts from the same category
 */
async function fetchRelatedParts(
  categoryId: number,
  excludePartId: number,
  limit: number = 6
): Promise<RelatedPart[]> {
  try {
    const client = getMeiliClient()
    const result = await client.index(PARTS_INDEX).search('', {
      filter: `categoryId = ${categoryId} AND id != ${excludePartId}`,
      limit: limit,
      attributesToRetrieve: [
        'id',
        'name',
        'price',
        'categoryId',
        'brandName',
        'brandLogo',
        'images',
        'formattedCompatibility',
        'oemCodes' // Using oemCodes for eans as it's the closest match in current index
      ]
    })

    const seeds: RelatedPartSeed[] = result.hits.map((hit: any) => ({
      id: parseInt(hit.id, 10),
      name: hit.name,
      price: hit.price ?? null,
      categoryId:
        typeof hit.categoryId === 'number' && Number.isInteger(hit.categoryId)
          ? hit.categoryId
          : categoryId,
      brandName: hit.brandName,
      brandLogo: hit.brandLogo,
      image: hit.images?.[0]?.image || null,
      thumb: hit.images?.[0]?.thumb || null,
      properties: [],
      eans: hit.oemCodes || [],
      isVehicleSpecific: (hit.formattedCompatibility?.length || 0) > 0,
      isBestseller: false
    }))

    return enrichRelatedPartsWithPublicPricing(seeds)
  } catch (error) {
    if (!isMeiliNoRouteError(error)) {
      console.error('❌ Error fetching related parts from Meilisearch:', error)
    }
    
    // Fallback: Fetch from database if Meilisearch fails
    try {
      console.log('🔄 Falling back to database for related parts...')
      const relatedParts = await db.parts.findMany({
        where: {
          category_id: categoryId,
          id: { not: BigInt(excludePartId) }
        },
        take: limit,
        include: {
          part_brands: {
            select: {
              name: true,
              logo_url: true
            }
          },
          part_images: {
            take: 1,
            select: {
              image: true,
              thumb: true
            }
          },
          part_eans: {
            select: {
              code: true
            }
          },
          part_pricing_inventory: {
            select: {
              supplier_price: true,
              computed_selling_price_ex_vat: true,
              supplier_stock_qty: true,
              reserved_stock_qty: true
            }
          },
          part_admin_overrides: {
            select: {
              lock_price: true,
              selling_price_override: true
            }
          }
        },
        orderBy: {
          id: 'asc'
        }
      })

      const seeds: RelatedPartSeed[] = relatedParts.map((part) => ({
        id: Number(part.id),
        name: part.name,
        price: part.price?.toString() ?? null,
        categoryId: part.category_id,
        brandName: part.part_brands.name,
        brandLogo: part.part_brands.logo_url,
        image: part.part_images[0]?.image || null,
        thumb: part.part_images[0]?.thumb || null,
        properties: [],
        eans: part.part_eans.map((ean) => ean.code),
        isVehicleSpecific: false,
        isBestseller: false
      }))

      return enrichRelatedPartsWithPublicPricing(seeds)
    } catch (dbError) {
      console.error('❌ Error fetching related parts from database:', dbError)
      return []
    }
  }
}

/**
 * Cached version of getRelatedParts
 */
export const getRelatedParts = async (
  categoryId: number,
  excludePartId: number,
  limit: number = 6
) =>
  await unstable_cache(
    async (categoryId: number, excludePartId: number, limit: number = 6) =>
      fetchRelatedParts(categoryId, excludePartId, limit),
    ['related-parts-v2'],
    { revalidate: 3600, tags: ['parts'] }
  )(categoryId, excludePartId, limit)
