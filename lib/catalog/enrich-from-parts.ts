import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normCodeSql } from './catalog-sql'

export interface EnrichFromPartsStats {
  candidateLinks: number
  autoApproved: number
  primaryPartsSet: number
  vehicleTypesCopied: number
  oemsCopied: number
  eansCopied: number
  imagesCopied: number
  propertiesCopied: number
  categoriesSet: number
  primaryImagesSet: number
}

/**
 * Enrich catalog products from the public.parts reference catalog (TecDoc-like,
 * refreshed periodically — so links are disposable, copied data is durable).
 *
 * 1. Candidate links: product_oems.code_norm ↔ normalized part_oens.code.
 * 2. Auto-approve when a product resolves to exactly ONE part via OEM.
 * 3. Copy from APPROVED links: vehicle fitment / OEMs / EANs (union over all
 *    approved links); images / properties / category / primary image only from
 *    the primary part to avoid mixing variants.
 *
 * Every step is idempotent (ON CONFLICT DO NOTHING / guarded updates); safe to
 * re-run after a parts refresh wipes the links.
 */
export async function enrichFromParts(options?: {
  onProgress?: (message: string) => void
}): Promise<EnrichFromPartsStats> {
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const candidateLinks = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_part_links
      (product_id, part_id, match_method, matched_code, confidence, status)
    SELECT DISTINCT ON (oe.product_id, po.part_id)
      oe.product_id,
      po.part_id,
      'OEM',
      oe.code,
      0.600,
      'CANDIDATE'
    FROM catalog.product_oems oe
    JOIN public.part_oens po ON ${normCodeSql(Prisma.sql`po.code`)} = oe.code_norm
    ON CONFLICT (product_id, part_id) DO NOTHING
  `)
  log(`[catalog-enrich] +${candidateLinks} candidate links (OEM)`)

  const autoApproved = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.product_part_links l
    SET status = 'APPROVED',
        confidence = 0.900,
        reviewed_at = NOW(),
        reviewed_by = 'auto:oem-single'
    FROM (
      SELECT product_id
      FROM catalog.product_part_links
      WHERE status <> 'REJECTED'
      GROUP BY product_id
      HAVING COUNT(DISTINCT part_id) = 1
    ) singles
    WHERE l.product_id = singles.product_id
      AND l.status = 'CANDIDATE'
      AND l.match_method = 'OEM'
  `)
  log(`[catalog-enrich] ${autoApproved} links auto-approved (single OEM candidate)`)

  const primaryPartsSet = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.products p
    SET primary_part_id = l.part_id
    FROM (
      SELECT product_id, MIN(part_id) AS part_id
      FROM catalog.product_part_links
      WHERE status = 'APPROVED'
      GROUP BY product_id
    ) l
    WHERE p.id = l.product_id
      AND p.primary_part_id IS NULL
  `)
  log(`[catalog-enrich] ${primaryPartsSet} primary parts set`)

  const vehicleTypesCopied = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_vehicle_types (product_id, vehicle_type_id, source)
    SELECT DISTINCT l.product_id, pvt.vehicle_type_id, 'PARTS'
    FROM catalog.product_part_links l
    JOIN public.part_vehicle_types pvt ON pvt.part_id = l.part_id
    WHERE l.status = 'APPROVED'
    ON CONFLICT (product_id, vehicle_type_id) DO NOTHING
  `)
  log(`[catalog-enrich] +${vehicleTypesCopied} vehicle fitments copied`)

  const oemsCopied = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_oems (product_id, code, code_norm, oem_brand, source)
    SELECT DISTINCT ON (l.product_id, ${normCodeSql(Prisma.sql`po.code`)})
      l.product_id,
      po.code,
      ${normCodeSql(Prisma.sql`po.code`)},
      NULLIF(po.brand, ''),
      'PARTS'
    FROM catalog.product_part_links l
    JOIN public.part_oens po ON po.part_id = l.part_id
    WHERE l.status = 'APPROVED'
      AND ${normCodeSql(Prisma.sql`po.code`)} IS NOT NULL
    ON CONFLICT (product_id, code_norm) DO NOTHING
  `)
  log(`[catalog-enrich] +${oemsCopied} OEM codes copied`)

  const eansCopied = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_eans (product_id, code, source)
    SELECT DISTINCT l.product_id, pe.code, 'PARTS'
    FROM catalog.product_part_links l
    JOIN public.part_eans pe ON pe.part_id = l.part_id
    WHERE l.status = 'APPROVED'
      AND NULLIF(TRIM(pe.code), '') IS NOT NULL
    ON CONFLICT (product_id, code) DO NOTHING
  `)
  log(`[catalog-enrich] +${eansCopied} EANs copied`)

  const imagesCopied = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_images (product_id, url, thumb, position, source)
    SELECT DISTINCT ON (p.id, pi.image)
      p.id,
      pi.image,
      pi.thumb,
      pi.id,
      'PARTS'
    FROM catalog.products p
    JOIN public.part_images pi ON pi.part_id = p.primary_part_id
    WHERE NULLIF(pi.image, '') IS NOT NULL
    ON CONFLICT (product_id, url) DO NOTHING
  `)
  log(`[catalog-enrich] +${imagesCopied} images copied`)

  const propertiesCopied = await db.$executeRaw(Prisma.sql`
    INSERT INTO catalog.product_properties (product_id, key, value, source)
    SELECT p.id, pp.key, pp.value, 'PARTS'
    FROM catalog.products p
    JOIN public.part_properties pp ON pp.part_id = p.primary_part_id
    ON CONFLICT (product_id, key) DO NOTHING
  `)
  log(`[catalog-enrich] +${propertiesCopied} properties copied`)

  const categoriesSet = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.products p
    SET category_id = pa.category_id
    FROM public.parts pa
    WHERE pa.id = p.primary_part_id
      AND p.category_id IS NULL
  `)
  log(`[catalog-enrich] ${categoriesSet} categories set`)

  const primaryImagesSet = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.products p
    SET primary_image_url = img.url
    FROM (
      SELECT DISTINCT ON (product_id) product_id, url
      FROM catalog.product_images
      ORDER BY product_id, position, id
    ) img
    WHERE img.product_id = p.id
      AND p.primary_image_url IS NULL
  `)
  log(`[catalog-enrich] ${primaryImagesSet} primary images set`)

  return {
    candidateLinks: Number(candidateLinks),
    autoApproved: Number(autoApproved),
    primaryPartsSet: Number(primaryPartsSet),
    vehicleTypesCopied: Number(vehicleTypesCopied),
    oemsCopied: Number(oemsCopied),
    eansCopied: Number(eansCopied),
    imagesCopied: Number(imagesCopied),
    propertiesCopied: Number(propertiesCopied),
    categoriesSet: Number(categoriesSet),
    primaryImagesSet: Number(primaryImagesSet)
  }
}
