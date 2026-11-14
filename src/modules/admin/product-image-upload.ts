import "server-only";
import sharp from "sharp";
import { productImageLimits } from "./product-image-limits";

// The limits live apart from sharp so the upload form can read them in the browser.
export { productImageLimits, productImageTypes } from "./product-image-limits";

const maxPixels = 40_000_000;

export type ProductImageErrorReason = "type" | "size" | "dimensions" | "unreadable";
export class ProductImageError extends Error {
  constructor(readonly reason: ProductImageErrorReason) {
    super(`Product image rejected: ${reason}`);
    this.name = "ProductImageError";
  }
}

/**
 * Checks an uploaded file and converts it for the store: JPEG, PNG or WebP with a single frame and both sides at least
 * 200 px; turned upright by its EXIF orientation, fit inside 2000×2000 (never enlarged) and written as WebP. sharp
 * writes no metadata unless asked, so EXIF (GPS included) does not reach the stored file.
 */
export async function prepareProductImage(raw: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  if (!raw.length || raw.length > productImageLimits.maxBytes) throw new ProductImageError("size");
  const meta = await sharp(raw, { limitInputPixels: maxPixels }).metadata().catch(() => { throw new ProductImageError("unreadable"); });
  if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw new ProductImageError("type");
  if (!meta.width || !meta.height) throw new ProductImageError("unreadable");
  if (meta.width * meta.height > maxPixels || Math.min(meta.width, meta.height) < productImageLimits.minSide) throw new ProductImageError("dimensions");
  const { data, info } = await sharp(raw, { limitInputPixels: maxPixels }).rotate()
    .resize(productImageLimits.maxSide, productImageLimits.maxSide, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 }).toBuffer({ resolveWithObject: true })
    .catch(() => { throw new ProductImageError("unreadable"); });
  return { bytes: data, width: info.width, height: info.height };
}
