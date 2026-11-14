"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { refreshSupplierScope } from "../actions";

export async function refreshDinamik(form: FormData) {
  const brand = String(form.get("brand") ?? "");
  const result = await refreshSupplierScope("dinamik", brand);
  revalidatePath("/yonetim/tedarikciler/dinamik");
  redirect(`/yonetim/tedarikciler/dinamik?brand=${encodeURIComponent(brand)}&${result.ok ? "updated=1" : `error=${result.error ?? "upstream"}`}`);
}
