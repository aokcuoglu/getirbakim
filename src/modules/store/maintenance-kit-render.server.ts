import "server-only";
import sharp, { type OverlayOptions } from "sharp";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { objectStorage } from "@/lib/object-storage";
import { kitBaseSvg, kitCanvas, kitLayout, packshotSvg, type KitLayer, type KitSelection } from "./maintenance-kit";

async function productPhoto(src: string) {
  const id = src.match(/^\/api\/product-media\/([0-9a-f-]{36})$/)?.[1];
  if (!id) return null;
  const media = (await db.query<{ bucket: string; object_key: string }>("SELECT bucket,object_key FROM product_media_objects WHERE id=$1", [id])).rows[0];
  if (!media) return null;
  try {
    const result = await objectStorage().send(new GetObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
    return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : null;
  } catch {
    return null;
  }
}

/** A layer as a composite input: the product photo (multiplied, so its white background drops out) or the generic packshot. */
async function layerInput(layer: KitLayer): Promise<OverlayOptions> {
  const width = Math.round(layer.width), height = Math.round(layer.height);
  const left = Math.round(layer.x), top = Math.round(layer.y);
  const photo = layer.item.image && await productPhoto(layer.item.image.src);
  if (photo) {
    const input = await sharp(photo).flatten({ background: "#ffffff" })
      .resize(width, height, { fit: "contain", position: "bottom", background: "#ffffff" }).png().toBuffer();
    return { input, left, top, blend: "multiply" };
  }
  const input = await sharp(Buffer.from(packshotSvg(layer.key, layer.item))).resize(width, height).png().toBuffer();
  return { input, left, top };
}

/** Same composition as the live preview, as a WebP for the cart, order summary and link previews. */
export async function renderMaintenanceKit(selection: KitSelection, size = kitCanvas) {
  const layers = kitLayout(selection);
  const overlays = await Promise.all(layers.map(layerInput));
  const image = await sharp(Buffer.from(kitBaseSvg(selection, layers)))
    .composite(overlays.map(overlay => ({ ...overlay, left: Math.max(0, overlay.left ?? 0), top: Math.max(0, overlay.top ?? 0) })))
    .png().toBuffer();
  return sharp(image).resize(size, size).webp({ quality: 86 }).toBuffer();
}
