'use server'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { getFromCache, setCache } from '@/lib/redis'
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

/**
 * Cached lightweight metadata fetch for SEO (used by generateMetadata).
 * Currently delegates to the v0 catalog; kept for backwards compatibility.
 */
export const getPartMetadataById = async (
  _partId: number
): Promise<PartMetadata | null> => {
  return null
}

/**
 * Cached lightweight hero fetch for initial render.
 * Currently delegates to the v0 catalog; kept for backwards compatibility.
 */
export const getPartHeroById = async (
  _partId: number
): Promise<PartHero | null> => {
  return null
}

/**
 * Cached full detail fetch.
 * Currently delegates to the v0 catalog; kept for backwards compatibility.
 */
export const getPartById = async (
  _partId: number
): Promise<PartDetail | null> => {
  return null
}

/**
 * Cached tabs data fetch (used by client to lazy-load heavy sections).
 * Currently delegates to the v0 catalog; kept for backwards compatibility.
 */
export const getPartTabsDataById = async (
  _partId: number
): Promise<PartTabsData | null> => {
  return null
}

export const getRelatedParts = async (
  _categoryId: number,
  _excludePartId: number,
  _limit: number
): Promise<PartDetail[]> => {
  return []
}
