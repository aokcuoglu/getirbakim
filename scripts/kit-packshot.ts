// Adds a packaging cut-out to the maintenance kit packshot library (#172).
// npm run kit:packshot -- --in box.png --family BOSCH --slot air [--source "Bosch distributor kit, 2026-10"]
// The input should already be a cut-out (transparent background, e.g. a manufacturer PNG or a
// Photoroom / rembg result). An opaque photo goes through `rembg` (BiRefNet) when it is installed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { kitSlotKeys, type KitSlotKey } from "../src/modules/store/maintenance-kit";

const { values } = parseArgs({ options: { in: { type: "string" }, family: { type: "string" }, slot: { type: "string" }, source: { type: "string" } } });
if (!values.in || !values.family || !kitSlotKeys.includes(values.slot as KitSlotKey)) {
  console.error(`Kullanım: --in <görsel> --family <BOSCH|MANN|...> --slot <${kitSlotKeys.join("|")}> [--source <kaynak/izin notu>]`);
  process.exit(1);
}
const family = values.family.toUpperCase(), slot = values.slot as KitSlotKey;
const dir = path.join(process.cwd(), "public", "kit-packshots");

let input = readFileSync(values.in);
if (!(await sharp(input).metadata()).hasAlpha) {
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
