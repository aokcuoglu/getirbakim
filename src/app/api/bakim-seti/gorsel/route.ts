import { createHash } from "node:crypto";
import { z } from "zod";
import { kitSlotKeys, kitTemplateVersion, type KitSlotKey } from "@/modules/store/maintenance-kit";
import { maintenanceKitItems } from "@/modules/store/maintenance-kit.server";
import { packshotManifest } from "@/modules/store/maintenance-kit-packshots.server";
import { renderMaintenanceKit } from "@/modules/store/maintenance-kit-render.server";

// Rendered images per kit, keyed by template version + slot ids (a process-local LRU for the prototype;
// the product version would store them in object storage).
const rendered = new Map<string, Buffer>();
const maxRendered = 200;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids: Partial<Record<KitSlotKey, string>> = {};
  for (const key of kitSlotKeys) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    if (!z.uuid().safeParse(value).success) return new Response(null, { status: 400 });
    ids[key] = value;
  }
  if (!Object.keys(ids).length) return new Response(null, { status: 400 });
  const size = url.searchParams.get("size") === "400" ? 400 : 1000;
  // The packshot library is part of the key: adding a brand's packaging changes the picture.
  const key = createHash("sha256").update(JSON.stringify([kitTemplateVersion, size, kitSlotKeys.map(slot => ids[slot] ?? ""), await packshotManifest()])).digest("hex").slice(0, 32);
  const etag = `"${key}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  let image = rendered.get(key);
  if (!image) {
    const selection = await maintenanceKitItems(ids);
    if (!Object.keys(selection).length) return new Response(null, { status: 404 });
    image = await renderMaintenanceKit(selection, size);
    rendered.set(key, image);
    if (rendered.size > maxRendered) rendered.delete(rendered.keys().next().value!);
  } else {
    rendered.delete(key);
    rendered.set(key, image);
  }
  return new Response(new Uint8Array(image), { headers: {
    "Content-Type": "image/webp", "Content-Length": String(image.length), "Cache-Control": "public, max-age=86400",
    ETag: etag, "X-Content-Type-Options": "nosniff",
  } });
}
