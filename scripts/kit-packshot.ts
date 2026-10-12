// Adds a packaging cut-out to the maintenance kit packshot library (#172).
// npm run kit:packshot -- --in box.png --family BOSCH --slot air [--source "Bosch distributor kit, 2026-10"]
//   [--crop left,top,width,height]  part of the image to keep, as fractions (0-1), e.g. only the box
//   [--erase l,t,w,h[@dx,dy];...]  regions to paint over (part numbers), fractions of the cropped image;
//                                   with @dx,dy the region is cloned from the clean area shifted by dx,dy
//   [--matte white|black]           studio shot on a plain background: removed by a flood fill from the
//                                   edges, so white areas inside the box stay
// Otherwise the input should be a cut-out (manufacturer PNG, Photoroom / rembg result); an opaque photo
// goes through `rembg` (BiRefNet) when it is installed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { kitSlotKeys, type KitSlotKey } from "../src/modules/store/maintenance-kit";

const { values } = parseArgs({ options: { in: { type: "string" }, family: { type: "string" }, slot: { type: "string" }, source: { type: "string" },
  crop: { type: "string" }, matte: { type: "string" }, erase: { type: "string" } } });
if (!values.in || !values.family || !kitSlotKeys.includes(values.slot as KitSlotKey)) {
  console.error(`Kullanım: --in <görsel> --family <BOSCH|MANN|...> --slot <${kitSlotKeys.join("|")}> [--source <kaynak/izin notu>]`);
  process.exit(1);
}
const family = values.family.toUpperCase(), slot = values.slot as KitSlotKey;
const dir = path.join(process.cwd(), "public", "kit-packshots");

/** Clears the plain background connected to the image edges; pixels near the edge of the cut get partial alpha. */
async function removePlainBackground(image: Buffer, matte: "white" | "black") {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const distance = (index: number) => matte === "white"
    ? 255 - Math.min(data[index], data[index + 1], data[index + 2])
    : Math.max(data[index], data[index + 1], data[index + 2]);
  const solid = 26, soft = 60;
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const push = (pixel: number) => { if (!visited[pixel] && distance(pixel * 4) < soft) { visited[pixel] = 1; queue[tail++] = pixel; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++], x = pixel % width, y = (pixel - x) / width;
    const d = distance(pixel * 4);
    data[pixel * 4 + 3] = d < solid ? 0 : Math.round(255 * (d - solid) / (soft - solid));
    if (d >= solid) continue; // soft edge pixels do not spread the fill into the product
    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (y > 0) push(pixel - width);
    if (y < height - 1) push(pixel + width);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

type EraseRegion = { rect: [number, number, number, number]; from?: [number, number] };
/** "l,t,w,h" fills the region from its surroundings; "l,t,w,h@dx,dy" clones it from the area shifted by dx,dy. */
const parseRegion = (spec: string): EraseRegion => {
  const [rect, from] = spec.split("@");
  return { rect: rect.split(",").map(Number) as EraseRegion["rect"], from: from ? from.split(",").map(Number) as [number, number] : undefined };
};

/**
 * Paints over regions (part numbers); pixels outside them are untouched.
 * - Clone (`from`): copies a clean area of the same face, blended in over a soft edge, so printed
 *   patterns and gradients continue.
 * - Fill: each region fills from its edge inwards, then is smoothed (harmonic fill); good on flat colour.
 */
async function eraseRegions(image: Buffer, regions: EraseRegion[]) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, channels = 3, feather = 6;
  const bounds = ([left, top, w, h]: EraseRegion["rect"]) => [Math.max(0, Math.floor(left * width)), Math.max(0, Math.floor(top * height)),
    Math.min(width, Math.ceil((left + w) * width)), Math.min(height, Math.ceil((top + h) * height))];
  const source = Buffer.from(data);
  for (const region of regions.filter(item => item.from)) {
    const [x0, y0, x1, y1] = bounds(region.rect), dx = Math.round(region.from![0] * width), dy = Math.round(region.from![1] * height);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const sx = Math.min(width - 1, Math.max(0, x + dx)), sy = Math.min(height - 1, Math.max(0, y + dy));
      const weight = Math.min(1, (Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y) + 1) / feather);
      for (let c = 0; c < channels; c++) {
        const i = (y * width + x) * channels + c;
        data[i] = Math.round(source[(sy * width + sx) * channels + c] * weight + data[i] * (1 - weight));
      }
    }
  }
  const neighbours = (pixel: number) => {
    const x = pixel % width, list: number[] = [];
    if (x > 0) list.push(pixel - 1);
    if (x < width - 1) list.push(pixel + 1);
    if (pixel >= width) list.push(pixel - width);
    if (pixel < width * (height - 1)) list.push(pixel + width);
    return list;
  };
  const luma = (pixel: number) => 0.3 * data[pixel * 3] + 0.59 * data[pixel * 3 + 1] + 0.11 * data[pixel * 3 + 2];
  for (const region of regions.filter(item => !item.from)) {
    const [x0, y0, x1, y1] = bounds(region.rect);
    const inside = (pixel: number) => { const x = pixel % width, y = (pixel - x) / width; return x >= x0 && x < x1 && y >= y0 && y < y1; };
    const pixels: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.push(y * width + x);
    // Border pixels far from the typical border colour (white letters next to a number on a dark box)
    // are not used as colour sources.
    const border = [...new Set(pixels.flatMap(pixel => neighbours(pixel).filter(n => !inside(n))))];
    const levels = border.map(luma).sort((a, b) => a - b), median = levels[Math.floor(levels.length / 2)] ?? 0;
    const usable = new Set(border.filter(pixel => Math.abs(luma(pixel) - median) < 45));
    // Onion peel: fill the outermost unknown pixels from their known neighbours, ring by ring.
    const known = new Set(usable);
    let ring = pixels.filter(pixel => neighbours(pixel).some(n => known.has(n)));
    const unfilled = new Set(pixels);
    while (ring.length) {
      for (const pixel of ring) {
        const sources = neighbours(pixel).filter(n => known.has(n));
        for (let c = 0; c < channels; c++) data[pixel * channels + c] = Math.round(sources.reduce((sum, n) => sum + data[n * channels + c], 0) / sources.length);
      }
      for (const pixel of ring) { known.add(pixel); unfilled.delete(pixel); }
      const next = new Set<number>();
      for (const pixel of ring) for (const n of neighbours(pixel)) if (unfilled.has(n)) next.add(n);
      ring = [...next];
    }
    // Smoothing removes the streaks the peel leaves (again only from usable border pixels).
    for (let iteration = 0; iteration < 300; iteration++)
      for (const pixel of pixels) {
        const around = neighbours(pixel).filter(n => known.has(n));
        if (!around.length) continue;
        for (let c = 0; c < channels; c++) data[pixel * channels + c] = Math.round(around.reduce((sum, n) => sum + data[n * channels + c], 0) / around.length);
      }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

let input = readFileSync(values.in);
if (values.crop) {
  const [left, top, width, height] = values.crop.split(",").map(Number);
  const meta = await sharp(input).metadata();
  input = await sharp(input).extract({ left: Math.round(left * meta.width!), top: Math.round(top * meta.height!),
    width: Math.round(width * meta.width!), height: Math.round(height * meta.height!) }).png().toBuffer();
}
if (values.erase) input = await eraseRegions(input, values.erase.split(";").map(parseRegion));
if (values.matte === "white" || values.matte === "black") input = await removePlainBackground(input, values.matte);
else if (!(await sharp(input).metadata()).hasAlpha) {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "kit-packshot-")), "cutout.png");
  try {
    execFileSync("rembg", ["i", "-m", "birefnet-general", values.in, out], { stdio: "inherit" });
  } catch {
    console.error("Görselde şeffaflık yok ve rembg bulunamadı. Önce arka planı kaldır (rembg, Photoroom) ya da `pipx install \"rembg[cli]\"`.");
    process.exit(1);
  }
  input = readFileSync(out);
}

// Trim the transparent margin so the box stands exactly on the layout's floor line.
const file = `${family.toLowerCase()}-${slot}.webp`;
const output = await sharp(input).trim({ threshold: 1 }).resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
  .webp({ quality: 90, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
writeFileSync(path.join(dir, file), output.data);

const manifestPath = path.join(dir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { family: string; slot: string }[];
const entry = { family, slot, file, width: output.info.width, height: output.info.height, source: values.source ?? "" };
writeFileSync(manifestPath, JSON.stringify([...manifest.filter(item => item.family !== family || item.slot !== slot), entry], null, 2) + "\n");
console.log(`Eklendi: ${file} (${entry.width}×${entry.height})`);
