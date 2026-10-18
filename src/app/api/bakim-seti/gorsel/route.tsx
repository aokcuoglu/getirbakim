import { ImageResponse } from "next/og";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { objectStorage } from "@/lib/object-storage";
import { staleCache } from "@/lib/stale-cache";
import { kitImageItems } from "@/modules/store/maintenance-kit.server";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import { kitContentLine, kitCountLabel, kitImageLayout, kitImageSize, kitKindLabel, maxKitImageItems, type KitImageCell, type KitSlotKey } from "@/modules/store/maintenance-kit";

/**
 * GET /api/bakim-seti/gorsel?urun=<id>,<id>,…: the sales picture of a maintenance kit, composed on the server
 * from the chosen products' own photos (white backgrounds trimmed), their brand logos and the headline panel
 * ("3'LÜ Filtre Seti / HAVA-YAĞ-POLEN"). The same ids in the same order always give the same picture; the
 * result is kept per process and cached by the browser and the CDN.
 */
const fontsDir = join(process.cwd(), "public/media/site/fonts");
const fonts = Promise.all([
  readFile(join(fontsDir, "Inter-SemiBold.ttf")).then(data => ({ name: "Inter", data, weight: 600 as const, style: "normal" as const })),
  readFile(join(fontsDir, "Inter-Medium.ttf")).then(data => ({ name: "Inter", data, weight: 500 as const, style: "normal" as const })),
]);
const idList = z.string().max(300).transform(value => value.split(",").map(id => id.trim()).filter(Boolean))
  .pipe(z.array(z.uuid()).min(1).max(maxKitImageItems));
const rendered = staleCache<{ body: Buffer; etag: string }>(24 * 60 * 60 * 1000, 200);

export async function GET(request: Request) {
  const ids = idList.safeParse(new URL(request.url).searchParams.get("urun") ?? "");
  if (!ids.success) return new Response("Ürün listesi geçersiz.", { status: 400 });
  const key = ids.data.join(",");
  try {
    const image = await rendered(key, () => render(ids.data));
    if (request.headers.get("if-none-match") === image.etag) return new Response(null, { status: 304, headers: { ETag: image.etag } });
    return new Response(new Uint8Array(image.body), { headers: {
      "Content-Type": "image/jpeg", "Content-Length": String(image.body.length), ETag: image.etag,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof KitImageError) return new Response(error.message, { status: error.status });
    console.error("Kit image could not be rendered", error instanceof Error ? error.message : error);
    return new Response("Set görseli oluşturulamadı.", { status: 503, headers: { "Retry-After": "30" } });
  }
}

class KitImageError extends Error { constructor(message: string, readonly status: number) { super(message); } }

type Photo = { src: string; width: number; height: number };
type Piece = { name: string; brand: string; slot: KitSlotKey | null; slotName: string; photo: Photo | null; logo: Photo | null };

async function render(ids: string[]) {
  const items = await kitImageItems(ids);
  if (!items.length) throw new KitImageError("Ürün bulunamadı.", 404);
  const logos = await getManufacturerLogos([...new Set(items.map(item => item.brand))]);
  const pieces: Piece[] = await Promise.all(items.map(async item => ({
    name: item.name, brand: item.brand, slot: item.slot?.key ?? null, slotName: item.slot?.name ?? "Parça",
    photo: (item.media && await productPhoto(item.media)) ?? await partArt(item.slot?.art ?? "parts"),
    logo: await logoData(logos.get(item.brand)?.src),
  })));
  const slots = pieces.flatMap(piece => piece.slot ?? []);
  const layout = kitImageLayout(pieces.length);
  const response = new ImageResponse(<Composite pieces={pieces} slots={slots} layout={layout} />,
    { width: kitImageSize, height: kitImageSize, fonts: await fonts });
  // PNG of several photos runs to 1-2 MB; the listing picture ships as JPEG like the product photos.
  const body = await sharp(Buffer.from(await response.arrayBuffer())).flatten({ background: "#ffffff" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { body, etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"` };
}

/** The product photo trimmed of its white margin and scaled for a cell, as a PNG data URL satori can place. */
async function productPhoto(media: { bucket: string; object_key: string }) {
  try {
    const result = await objectStorage().send(new GetObjectCommand({ Bucket: media.bucket, Key: media.object_key }));
    if (!result.Body) return null;
    const source = Buffer.from(await result.Body.transformToByteArray());
    const trimmed = await sharp(source).flatten({ background: "#ffffff" }).trim({ background: "#ffffff", threshold: 24 }).toBuffer();
    const { data, info } = await sharp(trimmed).resize(640, 640, { fit: "inside", withoutEnlargement: false }).png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
    return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch (error) {
    console.error("Kit image: product photo skipped", error instanceof Error ? error.name : error);
    return null;
  }
}

/** The same generic drawing the page shows for a product without a photo (public/media/part-art, rendered by scripts/render-part-art.tsx). */
async function partArt(kind: string): Promise<Photo | null> {
  try {
    const svg = await readFile(join(process.cwd(), "public/media/part-art", `${kind}.svg`));
    const { data, info } = await sharp(svg, { density: 300 }).resize(560, 400, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch (error) {
    console.error("Kit image: part art skipped", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Static logos live under public/; database logos come through their own route, so both are read as files or fetched locally. */
async function logoData(src: string | undefined): Promise<Photo | null> {
  if (!src) return null;
  const photo = async (file: Buffer) => {
    const { data, info } = await sharp(file).resize(240, 80, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  };
  try {
    const path = src.split("?")[0];
    if (path.startsWith("/media/")) {
      return await photo(await readFile(join(process.cwd(), "public", path)));
    }
    const match = /^\/api\/manufacturer-logos\/([A-Z0-9]+)/.exec(path);
    if (!match) return null;
    const { db } = await import("@/lib/db");
    const row = (await db.query<{ image_data: Buffer }>("SELECT image_data FROM manufacturer_logos WHERE brand_key=$1", [match[1]])).rows[0];
    return row ? await photo(row.image_data) : null;
  } catch { return null; }
}

const colors = { panel: "#0077c7", panelText: "#ffffff", headline: "#0b2a4a", text: "#222831", muted: "#626b75", border: "#e5e7eb", canvas: "#ffffff" };

function Composite({ pieces, slots, layout }: { pieces: Piece[]; slots: KitSlotKey[]; layout: ReturnType<typeof kitImageLayout> }) {
  const count = pieces.length;
  const headline = kitCountLabel(count, true), kind = kitKindLabel(slots), content = kitContentLine(slots) || pieces.map(piece => piece.slotName.toLocaleUpperCase("tr")).join("-");
  const panel = layout.panel;
  const scale = panel.width / 520;
  return <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: colors.canvas, fontFamily: "Inter", position: "relative" }}>
    <div style={{ position: "absolute", left: panel.x, top: panel.y, width: panel.width, height: panel.height, display: "flex", flexDirection: "column",
      justifyContent: "center", alignItems: "center", backgroundColor: colors.panel, borderRadius: 28 * scale, color: colors.panelText, padding: 24 * scale }}>
      <div style={{ display: "flex", fontSize: 176 * scale, lineHeight: 1, fontWeight: 600, letterSpacing: -8 * scale, color: colors.panelText }}>{headline}</div>
      <div style={{ display: "flex", marginTop: 18 * scale, fontSize: 64 * scale, lineHeight: 1.1, fontWeight: 600, letterSpacing: -1.5 * scale }}>{kind}</div>
      <div style={{ display: "flex", marginTop: 14 * scale, fontSize: count > 4 ? 26 * scale : 32 * scale, lineHeight: 1.2, fontWeight: 600, letterSpacing: 1.5 * scale, textAlign: "center", opacity: 0.92 }}>{content}</div>
    </div>
    {pieces.map((piece, index) => <Cell key={index} piece={piece} cell={layout.cells[index]} large={index === 0} />)}
    <div style={{ position: "absolute", left: panel.x, bottom: 10, display: "flex", fontSize: 18, color: colors.muted, fontWeight: 500 }}>getirbakim.com · Temsili görsel; set içeriği seçilen ürünlerden oluşur.</div>
  </div>;
}

/** Width and height of `photo` scaled to fit the box. */
function fit(photo: Photo, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / photo.width, maxHeight / photo.height);
  return { width: Math.round(photo.width * ratio), height: Math.round(photo.height * ratio) };
}

function Cell({ piece, cell, large }: { piece: Piece; cell: KitImageCell; large: boolean }) {
  const captionHeight = large ? 84 : 72, photoHeight = cell.height - captionHeight, pad = large ? 24 : 12;
  const brandLabel = piece.brand.length > 18 ? piece.brand.slice(0, 17) + "…" : piece.brand;
  const photoSize = piece.photo && fit(piece.photo, cell.width - 2 * pad, photoHeight - 2 * pad);
  const logoSize = piece.logo && fit(piece.logo, cell.width - 32, large ? 40 : 32);
  // Photo and caption sit together in the middle of the cell, so a short photo does not float far above its label.
  return <div style={{ position: "absolute", left: cell.x, top: cell.y, width: cell.width, height: cell.height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
    <div style={{ display: "flex", width: "100%", maxHeight: photoHeight, alignItems: "center", justifyContent: "center", padding: pad }}>
      {/* satori draws plain <img> elements; next/image has no place in a rendered picture. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {piece.photo && photoSize ? <img src={piece.photo.src} alt="" width={photoSize.width} height={photoSize.height} style={{ width: photoSize.width, height: photoSize.height }} />
        : <div style={{ display: "flex", width: "70%", height: "70%", borderRadius: 24, border: `3px solid ${colors.border}`, alignItems: "center", justifyContent: "center", fontSize: 28, color: colors.muted }}>Görsel hazırlanıyor</div>}
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: captionHeight, gap: 4 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {piece.logo && logoSize ? <img src={piece.logo.src} alt="" width={logoSize.width} height={logoSize.height} style={{ width: logoSize.width, height: logoSize.height }} />
        : <div style={{ display: "flex", fontSize: large ? 30 : 24, fontWeight: 600, color: colors.headline }}>{brandLabel}</div>}
      <div style={{ display: "flex", fontSize: large ? 24 : 20, fontWeight: 500, color: colors.muted }}>{piece.slotName}</div>
    </div>
  </div>;
}
