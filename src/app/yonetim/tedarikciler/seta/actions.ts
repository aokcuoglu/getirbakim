"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { importSeta, SetaImportError } from "@/modules/suppliers/seta-import";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function refreshSeta() {
  await requireAdmin();
  let error = "";
  try {
    await importSeta(db, { mode: "full" });
  } catch (cause) {
    error = cause instanceof SetaImportError ? cause.reason : "upstream";
  }
  revalidatePath("/yonetim/tedarikciler/seta");
  redirect(`/yonetim/tedarikciler/seta?${error ? `error=${error}` : "updated=1"}`);
}
