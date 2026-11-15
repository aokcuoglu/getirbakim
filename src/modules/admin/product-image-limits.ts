/** Admin uploads of product images (#581): raw file size, images per product, accepted and stored dimensions. */
export const productImageLimits = { maxBytes: 8 * 1024 * 1024, maxImages: 12, minSide: 200, maxSide: 2000 } as const;
export const productImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
/** Longest image URL an admin may paste to add an image from the web (#725). */
export const remoteImageUrlMaxLength = 2048;
