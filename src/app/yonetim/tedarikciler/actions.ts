"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { BasbugImportError, importBasbug, importOptions } from "@/modules/suppliers/basbug-import";
import { DinamikImportError, dinamikImportOptions, importDinamik } from "@/modules/suppliers/dinamik-import";
import { refreshBasbugPriceAnomalies, setPriceAnomalyStatus as storePriceAnomalyStatus } from "@/modules/suppliers/price-anomalies";
import { importSeta, SetaImportError } from "@/modules/suppliers/seta-import";

export type SupplierRefreshResult = { ok: boolean; error?: string; products?: number };
const supplierSchema = z.enum(["basbug", "dinamik", "seta"]);

// One request per scope (Başbuğ group, Dinamik brand, SETA list) keeps a manual refresh from becoming one long request;
// the admin page runs them in sequence and refreshes itself once at the end (no per-scope revalidation: it re-rendered the page every time). Imports record their own runs and scope health, as scheduled runs do.
export async function refreshSupplierScope(supplier: string, group: string): Promise<SupplierRefreshResult> {
  await requireAdmin();
  const parsed = supplierSchema.safeParse(supplier);
  if (!parsed.success) return { ok: false, error: "contract" };
  try {
    if (parsed.data === "basbug") {
      const input = importOptions.safeParse({ group, warehouse: "MRK" });
      if (!input.success) return { ok: false, error: "contract" };
      const result = await importBasbug(db, input.data);
      await refreshBasbugPriceAnomalies(db);
      return { ok: true, products: result.uniqueProducts };
    }
    if (parsed.data === "dinamik") {
      const input = dinamikImportOptions.safeParse({ brand: group });
      if (!input.success) return { ok: false, error: "contract" };
      return { ok: true, products: (await importDinamik(db, input.data)).uniqueProducts };
    }
    return { ok: true, products: (await importSeta(db, { mode: "full" })).uniqueProducts };
  } catch (cause) {
    // Dinamik answers 401/403 to hosts outside its IP allow-list (a Mac without the SSH tunnel); every brand would fail.
    if (cause instanceof DinamikImportError && cause.reason === "upstream" && /HTTP 40[13]\b/.test(cause.message)) return { ok: false, error: "forbidden" };
    const known = cause instanceof BasbugImportError || cause instanceof DinamikImportError || cause instanceof SetaImportError;
    return { ok: false, error: known ? cause.reason : "upstream" };
  }
}

const anomalyStatusSchema = z.object({ id: z.uuid(), status: z.enum(["open", "dismissed"]) });
/**
 * "Anomali değil" (dismissed: priced again, kept through later refreshes until the supplier value moves materially,
 * #1142) or "Yeniden işaretle" (open: unpriced).
 */
export async function setPriceAnomalyStatus(form: FormData) {
  const admin = await requireAdmin();
  const input = anomalyStatusSchema.safeParse({ id: form.get("id"), status: form.get("status") });
  if (!input.success) return;
  await storePriceAnomalyStatus(db, input.data.id, input.data.status, admin.id);
  revalidatePath("/yonetim/tedarikciler");
}
