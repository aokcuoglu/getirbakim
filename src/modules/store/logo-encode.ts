import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Pixel boxes the stored logos must fit into: twice the largest CSS display size, for 2x screens.
 * vehicle: `.make-tile-logo` (92 × 42), manufacturer: the largest `.home-brand-logo` (120 × 50).
 */
export const logoBoxes = {
  vehicle: { width: 184, height: 84 },
  manufacturer: { width: 240, height: 100 },
} as const;

export type LogoBox = { width: number; height: number };

/**
 * Fits a logo inside `box` without enlarging it. A logo already inside the box is returned untouched, so a second
 * run never adds another lossy pass.
 */
export async function fitLogo(bytes: Buffer, box: LogoBox, format: "webp" | "png") {
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error("Unreadable logo dimensions");
  if (meta.width <= box.width && meta.height <= box.height) {
    return { bytes, width: meta.width, height: meta.height, sha256: sha256Of(bytes), changed: false };
  }
  const resized = sharp(bytes).resize({ ...box, fit: "inside", withoutEnlargement: true });
  const { data, info } = await (format === "webp"
    ? resized.webp({ quality: 90, alphaQuality: 100, effort: 6 })
    : resized.png({ compressionLevel: 9 })
  ).toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, sha256: sha256Of(data), changed: true };
}

function sha256Of(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
