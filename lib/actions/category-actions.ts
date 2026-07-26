'use server'

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { uploadFile, uploadImageFromUrl } from '@/lib/storage'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const CATEGORIES_CACHE_TTL_MS = 60 * 1000

// Derive the row type from the columns actually selected, not from the whole
// model — otherwise every column added to part_categories (e.g. the archive's
// trodo_category_id) silently breaks this type against a query that never
// selected it.
const CATEGORY_SELECT = {
  id: true,
  name: true,
  name_tr: true,
  is_active: true,
  parent_id: true,
  url_key: true,
  is_main_nav: true,
  has_childs: true,
  image: true
} as const

type CategoryRow = Prisma.part_categoriesGetPayload<{ select: typeof CATEGORY_SELECT }>
type CategoryTree = CategoryRow & { children: CategoryTree[] }
type GetCategoriesSuccess = {
  success: true
  data: CategoryTree[]
  flat: CategoryRow[]
}
type GetCategoriesError = {
  success: false
  error: string
}

let categoriesCache:
  | {
      expiresAt: number
      value: GetCategoriesSuccess
    }
  | null = null

function invalidateCategoriesCache() {
  categoriesCache = null
}

const categorySchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1, 'Name is required'),
  name_tr: z.string().optional().nullable(),
  parent_id: z.number().optional().nullable(),
  url_key: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  is_main_nav: z.boolean().default(false),
  has_childs: z.boolean().default(false)
})

export async function getCategories(): Promise<GetCategoriesSuccess | GetCategoriesError> {
  try {
    const now = Date.now()
    if (categoriesCache && categoriesCache.expiresAt > now) {
      return categoriesCache.value
    }

    const categories = await db.part_categories.findMany({
      select: CATEGORY_SELECT,
      orderBy: { id: 'asc' }
    })

    // Build tree structure
    const categoryMap = new Map<number, CategoryTree>()
    const rootCategories: CategoryTree[] = []

    // First pass: create all nodes
    categories.forEach((cat) => {
      categoryMap.set(cat.id, {
        ...cat,
        children: []
      })
    })

    // Second pass: build tree
    categories.forEach((cat) => {
      const node = categoryMap.get(cat.id)!
      if (cat.parent_id) {
        const parent = categoryMap.get(cat.parent_id)
        if (parent) {
          parent.children.push(node)
        } else {
          rootCategories.push(node)
        }
      } else {
        rootCategories.push(node)
      }
    })

    const value: GetCategoriesSuccess = {
      success: true,
      data: rootCategories,
      flat: categories
    }
    categoriesCache = {
      expiresAt: now + CATEGORIES_CACHE_TTL_MS,
      value
    }

    return value
  } catch (error: any) {
    console.error('Error fetching categories:', error)
    return { success: false, error: error?.message || 'Unknown error' }
  }
}

export async function getCategoryById(id: number) {
  try {
    const category = await db.part_categories.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        name_tr: true,
        is_active: true,
        parent_id: true,
        url_key: true,
        is_main_nav: true,
        has_childs: true,
        image: true
      }
    })

    if (!category) {
      return { success: false, error: 'Category not found' }
    }

    return { success: true, data: category }
  } catch (error: any) {
    console.error('Error fetching category:', error)
    return { success: false, error: error.message }
  }
}

export async function uploadCategoryImage(file: File): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
    const filePath = fileName

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadFile(buffer, filePath, file.type, 'category-images')

    if (!result.publicUrl) {
      return { success: false, error: result.error || 'Upload failed' }
    }

    return { success: true, url: filePath }
  } catch (error: any) {
    console.error('Error uploading image:', error)
    return { success: false, error: error.message }
  }
}

export async function uploadCategoryImageFromUrl(imageUrl: string): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const urlPath = new URL(imageUrl).pathname
    const fileExt = urlPath.split('.').pop() || 'jpg'
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    const result = await uploadImageFromUrl(imageUrl, fileName, { bucket: 'category-images' })
    if (!result.publicUrl) {
      return { success: false, error: result.error || 'Failed to upload image' }
    }

    return { success: true, url: fileName }
  } catch (error: any) {
    console.error('Error uploading image from URL:', error)
    return { success: false, error: error.message }
  }
}

export async function createCategory(formData: FormData) {
  try {
    const rawData = {
      name: formData.get('name'),
      name_tr: formData.get('name_tr') || null,
      parent_id: formData.get('parent_id') ? parseInt(formData.get('parent_id') as string) : null,
      url_key: formData.get('url_key') || null,
      is_active: formData.get('is_active') === 'true',
      is_main_nav: formData.get('is_main_nav') === 'true',
      has_childs: formData.get('has_childs') === 'true'
    }

    const validatedData = categorySchema.parse(rawData)
    const imageFile = formData.get('image') as File | null
    const imageUrlUploaded = formData.get('image_url_uploaded') as string | null

    let imageUrl: string | null = null

    // Priority: uploaded URL > file upload
    if (imageUrlUploaded && imageUrlUploaded.trim()) {
      // Image was uploaded from URL, already in storage
      imageUrl = imageUrlUploaded.trim()
    } else if (imageFile && imageFile.size > 0) {
      // Upload file to storage
      const uploadResult = await uploadCategoryImage(imageFile)
      if (uploadResult.success && uploadResult.url) {
        imageUrl = uploadResult.url
      } else {
        return { success: false, error: uploadResult.error || 'Image upload failed' }
      }
    }

    // Create category - id is required in schema but we'll let Prisma handle it
    // Use type assertion since id should be auto-generated but schema doesn't have @default(autoincrement())
    const { id: _id, ...createData } = validatedData
    const category = await db.part_categories.create({
      data: {
        ...createData,
        image: imageUrl
      } as Parameters<typeof db.part_categories.create>[0]['data']
    })

    // Update parent's has_childs if parent exists
    if (validatedData.parent_id) {
      await db.part_categories.update({
        where: { id: validatedData.parent_id },
        data: { has_childs: true }
      })
    }

    invalidateCategoriesCache()
    revalidatePath('/admin/categories')
    return { success: true, data: category }
  } catch (error: any) {
    console.error('Error creating category:', error)
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message || 'Validation error' }
    }
    return { success: false, error: error.message }
  }
}

export async function updateCategory(id: number, formData: FormData) {
  try {
    const rawData = {
      name: formData.get('name'),
      name_tr: formData.get('name_tr') || null,
      parent_id: formData.get('parent_id') ? parseInt(formData.get('parent_id') as string) : null,
      url_key: formData.get('url_key') || null,
      is_active: formData.get('is_active') === 'true',
      is_main_nav: formData.get('is_main_nav') === 'true',
      has_childs: formData.get('has_childs') === 'true'
    }

    const validatedData = categorySchema.parse(rawData)
    const imageFile = formData.get('image') as File | null
    const imageUrlUploaded = formData.get('image_url_uploaded') as string | null

    // Get current category to check if image should be updated
    const currentCategory = await db.part_categories.findUnique({
      where: { id },
      select: { image: true, parent_id: true }
    })

    if (!currentCategory) {
      return { success: false, error: 'Category not found' }
    }

    let imageUrl: string | null | undefined = currentCategory.image

    // Priority: uploaded URL > file upload
    if (imageUrlUploaded && imageUrlUploaded.trim()) {
      // Image was uploaded from URL, already in storage
      imageUrl = imageUrlUploaded.trim()
    } else if (imageFile && imageFile.size > 0) {
      // Upload file to storage
      const uploadResult = await uploadCategoryImage(imageFile)
      if (uploadResult.success && uploadResult.url) {
        imageUrl = uploadResult.url
      } else {
        return { success: false, error: uploadResult.error || 'Image upload failed' }
      }
    }

    // Update category
    const category = await db.part_categories.update({
      where: { id },
      data: {
        ...validatedData,
        image: imageUrl
      }
    })

    // Update parent's has_childs if parent changed
    if (validatedData.parent_id !== currentCategory.parent_id) {
      // Update old parent
      if (currentCategory.parent_id) {
        const oldParentChildren = await db.part_categories.count({
          where: { parent_id: currentCategory.parent_id }
        })
        await db.part_categories.update({
          where: { id: currentCategory.parent_id },
          data: { has_childs: oldParentChildren > 0 }
        })
      }
      // Update new parent
      if (validatedData.parent_id) {
        await db.part_categories.update({
          where: { id: validatedData.parent_id },
          data: { has_childs: true }
        })
      }
    }

    invalidateCategoriesCache()
    revalidatePath('/admin/categories')
    return { success: true, data: category }
  } catch (error: any) {
    console.error('Error updating category:', error)
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message || 'Validation error' }
    }
    return { success: false, error: error.message }
  }
}

export async function deleteCategory(id: number) {
  try {
    // Check if category has children
    const childrenCount = await db.part_categories.count({
      where: { parent_id: id }
    })

    if (childrenCount > 0) {
      return { success: false, error: 'Cannot delete category with children. Please delete or move children first.' }
    }

    // Check if category has parts
    const partsCount = await db.parts.count({
      where: { category_id: id }
    })

    if (partsCount > 0) {
      return { success: false, error: 'Cannot delete category with associated parts.' }
    }

    const category = await db.part_categories.findUnique({
      where: { id },
      select: { parent_id: true }
    })

    await db.part_categories.delete({
      where: { id }
    })

    // Update parent's has_childs if parent exists
    if (category?.parent_id) {
      const remainingChildren = await db.part_categories.count({
        where: { parent_id: category.parent_id }
      })
      await db.part_categories.update({
        where: { id: category.parent_id },
        data: { has_childs: remainingChildren > 0 }
      })
    }

    invalidateCategoriesCache()
    revalidatePath('/admin/categories')
    return { success: true }
  } catch (error: any) {
    console.error('Error deleting category:', error)
    return { success: false, error: error.message }
  }
}
