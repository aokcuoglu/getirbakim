import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { manualCategories } from "@/modules/suppliers/manual-import";
import { buildManualTemplate } from "@/modules/suppliers/manual-template";

// The empty upload template; its category list is read from the current category tree.
export async function GET() {
  await requireAdmin();
  const body = await buildManualTemplate(await manualCategories(db));
  return new Response(new Uint8Array(body), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": "attachment; filename=\"manuel-urun-sablonu.xlsx\"",
    "Cache-Control": "no-store",
  } });
}
