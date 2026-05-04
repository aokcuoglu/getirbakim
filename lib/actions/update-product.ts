'use server'

import { db } from '@/lib/db'
import {
  fullProductUpdateSchema,
  type FullProductUpdateInput
} from '@/lib/validations/product'

interface ActionResult {
  success: boolean
  message: string
  errors?: Record<string, string[]>
}

/**
 * Server Action to update a product (parts table)
 * NOTE: This was designed for a 'products' table that doesn't exist.
 * Adapting to use the 'parts' table instead.
 */
export async function updateProduct(
  productId: number,
  input: FullProductUpdateInput
): Promise<ActionResult> {
  try {
    // Validate input with Zod
    const parseResult = fullProductUpdateSchema.safeParse(input)

    if (!parseResult.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const error of parseResult.error.issues) {
        const path = error.path.join('.')
        if (!fieldErrors[path]) {
          fieldErrors[path] = []
        }
        fieldErrors[path].push(error.message)
      }
      return {
        success: false,
        message: 'Validation failed',
        errors: fieldErrors
      }
    }

    const { product, pricing } = parseResult.data

    // Update part in database
    await db.parts.update({
      where: { id: BigInt(productId) },
      data: {
        name: product.partNumber,
        price: pricing?.sellingPrice?.toString() || null,
        updated_at: new Date()
      }
    })

    return {
      success: true,
      message: 'Product updated successfully'
    }
  } catch (error) {
    console.error('[updateProduct] Error:', error)
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'Failed to update product'
    }
  }
}
