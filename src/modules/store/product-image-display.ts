import type { CatalogProductImage } from "./product-enrichment";

/**
 * The images a product page shows (#581): the admin's uploads in their order, then the automatic enrichment image
 * unless the admin hid it. An image listed twice (the same media uploaded and found by enrichment) is shown once.
 */
export function galleryImages(uploaded: CatalogProductImage[], automatic: CatalogProductImage | null | undefined, hideAutomatic: boolean) {
  const images: CatalogProductImage[] = [];
  for (const image of [...uploaded, ...(automatic && !hideAutomatic ? [automatic] : [])])
    if (!images.some(shown => shown.src === image.src)) images.push(image);
  return images;
}

/**
 * The product page's share image (#595): the first image the gallery shows, so an admin upload wins over the automatic
 * one. Sizes are passed only when known. A product without an image falls back to the site's share image.
 */
export function socialImage(images: CatalogProductImage[], alt: string, fallback: { url: string; width: number; height: number; alt: string }) {
  const image = images[0];
  if (!image) return fallback;
  return { url: image.src, alt, ...(image.width > 0 && image.height > 0 ? { width: image.width, height: image.height } : {}) };
}
