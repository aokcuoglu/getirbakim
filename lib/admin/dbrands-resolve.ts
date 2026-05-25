import {
  resolveDbrandsIdByBrand,
  resolveDbrandsIdsByBrand,
} from '@/lib/admin/dbrands-id'

export { resolveDbrandsIdByBrand, resolveDbrandsIdsByBrand }

export async function resolveDbrandsIdByBrandOrThrow(brand: string): Promise<bigint> {
  const id = await resolveDbrandsIdByBrand(brand)
  if (id == null) {
    throw new Error(`dbrands kaydı bulunamadı: ${brand}`)
  }
  return id
}
