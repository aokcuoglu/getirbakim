'use server'

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { buildCatalogPrice } from '@/lib/catalog/store-view'
import { toBrandSlug } from '@/lib/v0/brandSlug'

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
  categoryName: string
  price: string | null
  image: string | null
  urlKey: string // catalog slug → /urun/{urlKey}
  type: 'product'
}

export type SearchResultBrand = {
  matchId: number
  brandName: string
  slug: string
  type: 'brand'
}

export type SearchResults = {
  categories: SearchResultCategory[]
  products: SearchResultProduct[]
  brands: SearchResultBrand[]
}

function generateCategorySlug(name: string, id: number): string {
  const base = name
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
  return `${base}-${id}`
}

/**
 * Global autocomplete search over the `catalog` schema (products + OEM codes),
 * plus category and brand suggestions. Products link to /urun/{slug}.
 */
export async function searchGlobal(query: string): Promise<SearchResults> {
  const empty: SearchResults = { categories: [], products: [], brands: [] }
  if (!query || query.trim().length < 2) return empty

  const q = query.trim()
  const compact = q.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const isCodeLike = /[0-9]/.test(q) && compact.replace(/[^0-9]/g, '').length >= 3

  const productWhere: Prisma.productsWhereInput = {
    status: 'ACTIVE',
    slug: { not: null },
    OR: isCodeLike
      ? [
          { part_no_norm: { startsWith: compact } },
          { product_oems: { some: { code_norm: { startsWith: compact } } } },
          { name: { contains: q, mode: 'insensitive' } }
        ]
      : [
          { name: { contains: q, mode: 'insensitive' } },
          { brand: { brand: { contains: q, mode: 'insensitive' } } }
        ]
  }

  const [categoryRows, productRows, brandRows] = await Promise.all([
    isCodeLike
      ? Promise.resolve([] as Array<{ id: number; name: string }>)
      : db.part_categories.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          select: { id: true, name: true },
          take: 5
        }),
    db.products.findMany({
      where: productWhere,
      orderBy: [{ in_stock: 'desc' }, { offer_count: 'desc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        primary_image_url: true,
        min_selling_price_try: true,
        brand: { select: { brand: true } },
        category: { select: { name: true } }
      },
      take: 8
    }),
    isCodeLike
      ? Promise.resolve([] as Array<{ id: number; brand: string; logo_url: string | null }>)
      : db.brands.findMany({
          where: { brand: { contains: q, mode: 'insensitive' } },
          select: { id: true, brand: true, logo_url: true },
          take: 5
        })
  ])

  const categories: SearchResultCategory[] = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: generateCategorySlug(c.name, c.id),
    image: null,
    type: 'category'
  }))

  const products: SearchResultProduct[] = productRows.map((p) => {
    const price = buildCatalogPrice(p.min_selling_price_try)
    return {
      id: Number(p.id),
      name: p.name,
      brandName: p.brand.brand,
      categoryName: p.category?.name ?? '',
      price: price.incVat != null ? price.incVat.toFixed(2) : null,
      image: p.primary_image_url,
      urlKey: p.slug ?? '',
      type: 'product'
    }
  })

  const brands: SearchResultBrand[] = brandRows.map((b) => ({
    matchId: b.id,
    brandName: b.brand,
    slug: toBrandSlug(null, b.brand),
    type: 'brand'
  }))

  return { categories, products, brands }
}
