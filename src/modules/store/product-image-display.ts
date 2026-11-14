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
