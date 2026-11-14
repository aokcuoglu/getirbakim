"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { importBasbug, importOptions, BasbugImportError } from "@/modules/suppliers/basbug-import";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export async function saveBasbugCheckoutMode(form: FormData) {
  const admin = await requireAdmin();
  const mode = z.enum(["live", "snapshot"]).safeParse(form.get("checkoutMode"));
  if (!mode.success) redirect("/yonetim/tedarikciler/basbug?error=mode");
  await db.query("UPDATE commerce_settings SET basbug_checkout_mode=$1,updated_at=now(),updated_by=$2 WHERE id=true", [mode.data, admin.id]);
  revalidatePath("/", "layout");
  redirect("/yonetim/tedarikciler/basbug?modeSaved=1");
}

export async function refreshBasbug(form: FormData) {
  await requireAdmin();
  const input = importOptions.safeParse({ group: form.get("group"), warehouse: "MRK" });
  if (!input.success) redirect("/yonetim/tedarikciler/basbug?error=contract");
  let error = "";
  try {
    await importBasbug(db, input.data);
  } catch (cause) {
    error = cause instanceof BasbugImportError ? cause.reason : "upstream";
  }
  revalidatePath("/yonetim/tedarikciler/basbug");
  redirect(`/yonetim/tedarikciler/basbug?group=${encodeURIComponent(input.data.group)}&${error ? `error=${error}` : "updated=1"}`);
}
