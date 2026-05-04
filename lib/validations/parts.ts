import { z } from 'zod'

export const createPartSchema = z.object({
  id: z.coerce.number().optional(), // Can be auto-generated or provided
  name: z.string().min(1, 'Parça adı zorunludur'),
  articleLinkId: z.coerce.number().int().positive('Article Link ID zorunludur'),
  price: z.coerce.number().min(0).optional().nullable(),
  inBasket: z.boolean().default(false),
  brandId: z.coerce.number().int().positive('Marka seçimi zorunludur'),
  categoryId: z.coerce.number().int().positive('Kategori seçimi zorunludur'),
  image: z.any().optional() // For the image file upload
})

export type CreatePartInput = z.infer<typeof createPartSchema>
