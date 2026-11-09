"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { imageLink, normalizePackage, normalizeViscosity, parseDecimal, parseManualWorkbook } from "@/modules/suppliers/manual-template";
import { importManualDraft, listSlug, ManualImportError, manualCategories, saveManualDraft, updateManualItem } from "@/modules/suppliers/manual-import";

const base = "/yonetim/tedarikciler/manuel";
const maxFileBytes = 8 * 1024 * 1024;

export async function uploadManualList(form: FormData) {
  const admin = await requireAdmin();
  const file = form.get("file");
  const existing = String(form.get("list") ?? "");
  const newName = String(form.get("new_list") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const fail = (error: string) => redirect(`${base}?${new URLSearchParams({ ...(existing && existing !== "new" ? { liste: existing } : {}), error })}`);
  if (!(file instanceof File) || !file.size) fail("file");
  const upload = file as File;
  if (!/\.xlsx$/i.test(upload.name) || upload.size > maxFileBytes) fail("file");
  let listGroup: string, listName: string;
  if (existing && existing !== "new") {
    const row = (await db.query<{ list_name: string }>(`SELECT product_data->>'list_name' AS list_name FROM supplier_items
      WHERE supplier='manual' AND list_group=$1 ORDER BY changed_at DESC LIMIT 1`, [existing])).rows[0];
    if (!row) fail("list");
    listGroup = existing; listName = row!.list_name;
  } else {
    listName = newName; listGroup = listSlug(newName);
    if (!listGroup) fail("list");
  }
  let id: string;
  try {
    const parsed = await parseManualWorkbook(await upload.arrayBuffer(), await manualCategories(db));
    id = await saveManualDraft(db, { listGroup: listGroup!, listName: listName!, fileName: upload.name, parsed, by: admin.id });
  } catch (error) {
    // An unreadable file (not an xlsx, password protected…) is the uploader's to fix; anything else is ours.
    if (error instanceof Error && /zip|xlsx|end of data|central directory|corrupted/i.test(error.message)) fail("unreadable");
    throw error;
  }
  revalidatePath(base);
  redirect(`${base}?${new URLSearchParams({ liste: listGroup!, taslak: id!, uploaded: "1" })}`);
}

const draftInput = z.object({ id: z.uuid(), list: z.string().max(60) });

export async function confirmManualDraft(form: FormData) {
  await requireAdmin();
  const input = draftInput.safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`${base}?error=input`);
  const { id, list } = input.data;
  let error = "", detail = "";
  try {
    await importManualDraft(db, id);
  } catch (cause) {
    if (!(cause instanceof ManualImportError)) throw cause;
    error = cause.reason; detail = cause.detail ?? "";
  }
  revalidatePath(base);
  revalidatePath("/katalog");
  redirect(`${base}?${new URLSearchParams(error ? { liste: list, taslak: id, error, ...(detail ? { detail } : {}) } : { liste: list, imported: "1" })}`);
}

export async function discardManualDraft(form: FormData) {
  await requireAdmin();
  const input = draftInput.safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`${base}?error=input`);
  await db.query("UPDATE manual_uploads SET status='discarded',decided_at=now() WHERE id=$1 AND status='draft'", [input.data.id]);
  revalidatePath(base);
  redirect(`${base}?${new URLSearchParams({ liste: input.data.list, discarded: "1" })}`);
}

const text = (form: FormData, key: string, max: number) => {
  const value = String(form.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
};

export async function saveManualItem(form: FormData) {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) redirect(base);
  const back = `${base}/urun/${id.data}`;
  const price = parseDecimal(text(form, "price", 40));
  const stock = parseDecimal(text(form, "stock", 40));
  const image = imageLink(text(form, "imageUrl", 2000));
  if (price === "invalid" || stock === "invalid" || (typeof stock === "number" && !Number.isInteger(stock)) || image.ignored)
    redirect(`${back}?error=input`);
  let error = "", detail = "";
  try {
    await updateManualItem(db, id.data, {
      price: typeof price === "number" && price > 0 ? price : null, stock: typeof stock === "number" ? stock : null,
      barcode: text(form, "barcode", 40)?.replace(/\s/g, "") ?? null, description: text(form, "description", 3000),
      viscosity: normalizeViscosity(text(form, "viscosity", 60)), package: normalizePackage(text(form, "package", 60)),
      approvals: text(form, "approvals", 1000), imageUrl: image.url,
    }, admin.id);
  } catch (cause) {
    if (!(cause instanceof ManualImportError)) throw cause;
    error = cause.reason; detail = cause.detail ?? "";
  }
  revalidatePath(base);
  revalidatePath(back);
  redirect(`${back}?${new URLSearchParams(error ? { error, ...(detail ? { detail } : {}) } : { saved: "1" })}`);
}
