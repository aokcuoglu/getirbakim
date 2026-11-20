import "server-only";
import { db } from "@/lib/db";

/**
 * An automatic image is generic when this many distinct manufacturer part numbers use it (#1091): media objects are
 * unique by sha256, so a tile the source repeats across parts ("Generic image for illustration purpose only",
 * watermark tiles, "Image coming soon", legal notices, stock drawings) is one image_id with many part numbers. A real
 * product photo is shared by a handful of variants at most.
 */
export const genericImageMinParts = 5;

/** The ids among `imageIds` that are generic automatic images; the storefront shows PartArt instead. */
export async function genericImageIds(imageIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(imageIds)];
  if (!ids.length) return new Set();
  const rows = (await db.query<{ image_id: string }>(
    `SELECT image_id FROM product_enrichments WHERE image_id = ANY($1::uuid[])
      GROUP BY image_id HAVING count(DISTINCT manufacturer_part_number) >= $2`,
    [ids, genericImageMinParts],
  )).rows;
  return new Set(rows.map(row => row.image_id));
}
