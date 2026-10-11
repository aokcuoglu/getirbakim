// Adds a packaging cut-out to the maintenance kit packshot library (#172).
// npm run kit:packshot -- --in box.png --family BOSCH --slot air [--source "Bosch distributor kit, 2026-10"]
//   [--crop left,top,width,height]  part of the image to keep, as fractions (0-1), e.g. only the box
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
  crop: { type: "string" }, matte: { type: "string" } } });
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

let input = readFileSync(values.in);
if (values.crop) {
  const [left, top, width, height] = values.crop.split(",").map(Number);
  const meta = await sharp(input).metadata();
  input = await sharp(input).extract({ left: Math.round(left * meta.width!), top: Math.round(top * meta.height!),
    width: Math.round(width * meta.width!), height: Math.round(height * meta.height!) }).png().toBuffer();
}
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
