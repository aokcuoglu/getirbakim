"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { importBasbug, importOptions, BasbugImportError } from "@/modules/suppliers/basbug-import";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
