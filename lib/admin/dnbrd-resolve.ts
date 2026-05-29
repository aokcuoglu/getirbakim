import {
  resolveDbrandsIdByBrand,
  resolveDbrandsIdsByBrand,
} from '@/lib/admin/dnbrd-id'

export { resolveDbrandsIdByBrand, resolveDbrandsIdsByBrand }

export async function resolveDbrandsIdByBrandOrThrow(brand: string): Promise<bigint> {
  const id = await resolveDbrandsIdByBrand(brand)
  if (id == null) {
    throw new Error(`dnbrd kaydı bulunamadı: ${brand}`)
  }
  return id
}
