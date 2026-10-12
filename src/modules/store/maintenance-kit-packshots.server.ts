import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KitImage, KitSlotKey } from "./maintenance-kit";

// Packaging cut-outs (transparent WebP) per brand family × slot, prepared with scripts/kit-packshot.ts.
// Prototype storage: public/kit-packshots + manifest.json. The product version keeps them in object
// storage with an admin approval step and a note of where each image came from (usage rights).
export const packshotDir = path.join(process.cwd(), "public", "kit-packshots");
export type PackshotEntry = { family: string; slot: KitSlotKey; file: string; width: number; height: number; source?: string };

let manifest: Promise<PackshotEntry[]> | undefined;
let loadedAt = 0;
export function packshotManifest() {
  // Re-read at most every 30 s so newly prepared packshots show up without a restart.
  if (!manifest || Date.now() - loadedAt > 30_000) {
    loadedAt = Date.now();
    manifest = readFile(path.join(packshotDir, "manifest.json"), "utf8")
      .then(text => JSON.parse(text) as PackshotEntry[]).catch(() => []);
  }
  return manifest;
}

export async function packshotFor(family: string, slot: KitSlotKey): Promise<KitImage | undefined> {
  const entry = (await packshotManifest()).find(item => item.family === family && item.slot === slot);
  return entry && { src: `/kit-packshots/${entry.file}`, width: entry.width, height: entry.height };
}
