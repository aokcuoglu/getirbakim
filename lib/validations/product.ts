'use server'

import { z } from 'zod'

// Zod schema for product update validation
export const productUpdateSchema = z.object({
  partNumber: z
    .string()
    .min(1, 'Part number is required')
    .max(100, 'Part number is too long'),
  productName: z
    .string()
    .min(1, 'Product name is required')
    .max(500, 'Product name is too long'),
  brand: z.string().max(100).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
  productUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
  subcategoryId: z.number().int().positive().nullable().optional(),
  productBrandId: z.number().int().positive().nullable().optional(),
  specifications: z.record(z.string(), z.string()).nullable().optional(),
  dimensionsAndSize: z.record(z.string(), z.string()).nullable().optional(),
  shippingDetails: z.record(z.string(), z.string()).nullable().optional(),
  references: z.array(z.string()).nullable().optional()
})

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>

// Zod schema for pricing update
export const productPricingSchema = z.object({
  sellingPrice: z.number().min(0).nullable().optional(),
  currency: z.enum(['TRY', 'USD', 'EUR']).default('TRY'),
  stockQuantity: z.number().int().min(0).default(0),
  reservedStock: z.number().int().min(0).default(0),
  minStockLevel: z.number().int().min(0).default(0)
})

export type ProductPricingInput = z.infer<typeof productPricingSchema>

// Combined schema for full product update (product + pricing)
export const fullProductUpdateSchema = z.object({
  product: productUpdateSchema,
  pricing: productPricingSchema.optional()
})

export type FullProductUpdateInput = z.infer<typeof fullProductUpdateSchema>
