'use server'

import { db } from '@/lib/db'
import { createPartSchema } from '@/lib/validations/parts'
import { revalidatePath } from 'next/cache'
import { uploadFile, getPublicUrl } from '@/lib/storage'

export async function createProduct(formData: FormData) {
  try {
    const rawData = {
      name: formData.get('name'),
      articleLinkId: formData.get('articleLinkId'),
      price: formData.get('price'),
      brandId: formData.get('brandId'),
      categoryId: formData.get('categoryId'),
      inBasket: formData.get('inBasket') === 'true'
    }

    const validatedData = createPartSchema.parse(rawData)
    const imageFile = formData.get('image') as File | null

    let imageUrl = ''

    if (imageFile && imageFile.size > 0) {
      const fileExt = imageFile.name.split('.').pop()
      const fileName = `${Math.random()}.${fileExt}`
      const filePath = `products/${fileName}`

      const buffer = Buffer.from(await imageFile.arrayBuffer())
      const result = await uploadFile(buffer, filePath, imageFile.type, 'products')

      if (!result.publicUrl) {
        throw new Error('Image upload failed')
      }

      imageUrl = result.publicUrl
    }

    // Use Prisma transaction
    const result = await db.$transaction(async (tx) => {
      const newPart = await tx.parts.create({
        data: {
          id: BigInt(Date.now()), // Generate a unique ID
          name: validatedData.name,
          article_link_id: BigInt(validatedData.articleLinkId),
          price: validatedData.price?.toString() || null,
          brand_id: validatedData.brandId,
          category_id: validatedData.categoryId,
          in_basket: validatedData.inBasket
        },
        select: { id: true }
      })

      if (imageUrl) {
        await tx.part_images.create({
          data: {
            part_id: newPart.id,
            image: imageUrl,
            thumb: imageUrl // Using same for thumb for now
          }
        })
      }

      return { id: Number(newPart.id) }
    })

    revalidatePath('/admin/products')
    revalidatePath('/[locale]/products', 'layout')

    return {
      success: true,
      message: 'Ürün başarıyla oluşturuldu',
      data: result
    }
  } catch (error) {
    console.error('Error in createProduct:', error)
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'Ürün oluşturulurken bir hata oluştu'
    }
  }
}

export async function getBrands() {
  const brands = await db.part_brands.findMany({
    select: {
      id: true,
      name: true
    },
    orderBy: { name: 'asc' },
    take: 100 // Safety limit
  })
  return brands
}

export async function getPartCategories() {
  const categories = await db.part_categories.findMany({
    select: {
      id: true,
      name: true
    },
    orderBy: { name: 'asc' },
    take: 100 // Safety limit
  })
  return categories.map((c) => ({ id: c.id, name: c.name }))
}
