import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { brandLogoLimits } from "./brand-logo-limits";
import { oneAtATime } from "./product-image-upload";

export { brandLogoLimits, brandLogoTypes } from "./brand-logo-limits";

const maxPixels = 25_000_000;
// SVG renders at 72 dpi by default; the density is scaled so the drawing fills the logo box, within these bounds.
const minDensity = 72;
const maxDensity = 2400;

// SVG limits checked on the markup before librsvg renders it: sharp's timeout does not stop librsvg, so a few KB of
// nested <use> or a filter could hold the shared image queue for many seconds. Real logos stay well below these.
const svgLimits = { elements: 3000, uses: 16 } as const;

/**
 * `complex`: an SVG with filters, entities or too many elements / <use> references; `text`: an SVG with live text
 * (the server has no fonts, so text must be converted to paths); `empty`: the converted logo is fully transparent.
 */
export type BrandLogoErrorReason = "type" | "size" | "dimensions" | "unreadable" | "complex" | "text" | "empty";
export class BrandLogoError extends Error {
  constructor(readonly reason: BrandLogoErrorReason) {
    super(`Brand logo rejected: ${reason}`);
    this.name = "BrandLogoError";
  }
}

export type PreparedBrandLogo = { bytes: Buffer; width: number; height: number; sha256: string };

/**
 * Checks an admin's logo file (#819) and converts it for the store: PNG, JPEG, WebP or SVG with a single frame, the
 * format read from the bytes (the declared type is not trusted). SVG is rasterised (scripts and event handlers never
 * run; the file itself is never stored or served). The result is turned upright, its plain border trimmed, fitted
 * inside 640×288 (never enlarged) and written as WebP with its transparency.
 */
export async function prepareBrandLogo(raw: Buffer): Promise<PreparedBrandLogo> {
  if (!raw.length || raw.length > brandLogoLimits.maxBytes) throw new BrandLogoError("size");
  return oneAtATime(() => convert(raw));
}

async function convert(raw: Buffer): Promise<PreparedBrandLogo> {
  // Only the header is read here; without the limit an oversized image is reported as "dimensions", not unreadable.
  const meta = await sharp(raw, { limitInputPixels: false }).metadata().catch(() => { throw new BrandLogoError("unreadable"); });
  if (!["jpeg", "png", "webp", "svg"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw new BrandLogoError("type");
  if (!meta.width || !meta.height) throw new BrandLogoError("unreadable");
  if (meta.format === "svg") checkSvg(raw);
  const density = meta.format === "svg"
    ? Math.min(maxDensity, Math.max(minDensity, 72 * Math.min(brandLogoLimits.maxWidth / meta.width, brandLogoLimits.maxHeight / meta.height)))
    : undefined;
  const scale = density ? density / 72 : 1;
  const width = Math.round(meta.width * scale);
  const height = Math.round(meta.height * scale);
  if (width * height > maxPixels || Math.min(width, height) < brandLogoLimits.minSide) throw new BrandLogoError("dimensions");
  const render = (trim: boolean) => {
    let image = sharp(raw, { limitInputPixels: maxPixels, density }).rotate();
    if (trim) image = image.trim();
    return image.resize(brandLogoLimits.maxWidth, brandLogoLimits.maxHeight, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90, alphaQuality: 100 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
  };
  // Only a failure of the trim itself is retried untrimmed; a timeout or a pixel limit is not run twice.
  const { data, info } = await render(true)
    .catch((error: unknown) => { if (error instanceof Error && /trim/i.test(error.message)) return render(false); throw error; })
    .catch(() => { throw new BrandLogoError("unreadable"); });
  if (data.length > brandLogoLimits.maxBytes) throw new BrandLogoError("size");
  const stats = await sharp(data).stats().catch(() => { throw new BrandLogoError("unreadable"); });
  if (stats.channels.length === 4 && stats.channels[3].max === 0) throw new BrandLogoError("empty");
  return { bytes: data, width: info.width, height: info.height, sha256: createHash("sha256").update(data).digest("hex") };
}

/** Rejects SVG markup that would be slow to render or render wrong on a server without fonts (see svgLimits). */
function checkSvg(raw: Buffer) {
  let markup: string;
  try {
    // SVGZ: inflated up to the upload limit only.
    markup = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: brandLogoLimits.maxBytes }) : raw).toString("utf8");
  } catch { throw new BrandLogoError("complex"); }
  const count = (pattern: RegExp) => markup.match(pattern)?.length ?? 0;
  if (/<!ENTITY/i.test(markup) || /<(?:[\w-]+:)?(?:filter|fe[A-Z]\w*)[\s/>]/.test(markup)) throw new BrandLogoError("complex");
  if (count(/<(?:[\w-]+:)?[A-Za-z][\w.-]*/g) > svgLimits.elements || count(/<(?:[\w-]+:)?use[\s/>]/g) > svgLimits.uses) throw new BrandLogoError("complex");
  if (/<(?:[\w-]+:)?(?:text|tspan|textPath)[\s/>]/.test(markup)) throw new BrandLogoError("text");
}
