"use server";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { imageLink, normalizePackage, normalizeViscosity, parseDecimal, parseManualWorkbook } from "@/modules/suppliers/manual-template";
import { importManualDraft, listSlug, ManualImportError, manualCategories, saveManualDraft, updateManualItem } from "@/modules/suppliers/manual-import";
import { parseManualBulkCsv } from "@/modules/suppliers/manual-bulk-csv";
import { applyManualBulkDraft, saveManualBulkDraft } from "@/modules/suppliers/manual-bulk";

const base = "/yonetim/tedarikciler/manuel";
const maxFileBytes = 8 * 1024 * 1024;
const maxCsvBytes = 2 * 1024 * 1024;

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
  // Every storefront listing (/katalog, /kategori, /yedek-parca) can show the imported products.
  revalidatePath("/", "layout");
  redirect(`${base}?${new URLSearchParams(error ? { liste: list, taslak: id, error, ...(detail ? { detail } : {}) } : { liste: list, imported: "1" })}`);
}

const bulkList = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);

/** Reads a price/stock CSV of an existing list (#832) and stores it as a draft with its diff; nothing changes yet. */
export async function uploadManualBulk(form: FormData) {
  const admin = await requireAdmin();
  const list = bulkList.safeParse(form.get("liste"));
  if (!list.success) redirect(`${base}?error=list`);
  const listGroup = list.data;
  const fail = (error: string) => redirect(`${base}?${new URLSearchParams({ liste: listGroup, error })}`);
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || !/\.csv$/i.test(file.name) || file.size > maxCsvBytes) fail("csv-file");
  const upload = file as File;
  const row = (await db.query<{ list_name: string }>(`SELECT product_data->>'list_name' AS list_name FROM supplier_items
    WHERE supplier='manual' AND list_group=$1 ORDER BY changed_at DESC LIMIT 1`, [listGroup])).rows[0];
  if (!row) fail("list");
  const parsed = parseManualBulkCsv(new Uint8Array(await upload.arrayBuffer()));
  const id = await saveManualBulkDraft(db, { listGroup, listName: row.list_name, fileName: upload.name, parsed, by: admin.id });
  revalidatePath(base);
  redirect(`${base}?${new URLSearchParams({ liste: listGroup, taslak: id, uploaded: "1" })}`);
}

/** Applies a reviewed CSV draft: list price, discount, cost, markup and stock of the changed products. */
export async function confirmManualBulk(form: FormData) {
  const admin = await requireAdmin();
  const input = draftInput.safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`${base}?error=input`);
  const { id, list } = input.data;
  let error = "", detail = "";
  try {
    await applyManualBulkDraft(db, id, admin.id);
  } catch (cause) {
    if (!(cause instanceof ManualImportError)) throw cause;
    error = cause.reason; detail = cause.detail ?? "";
  }
  revalidatePath(base);
  // Prices and stock show on every storefront listing.
  revalidatePath("/", "layout");
  redirect(`${base}?${new URLSearchParams(error ? { liste: list, taslak: id, error, ...(detail ? { detail } : {}) } : { liste: list, bulk: "1" })}`);
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

/** Not edited (the form shows what it sent back as `was_*`) = undefined; emptied = null. */
const edited = <T>(value: T | null, was: T | null, same: (a: T, b: T) => boolean) =>
  value === null ? was === null ? undefined : null : was !== null && same(value, was) ? undefined : value;

export async function saveManualItem(form: FormData) {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) redirect(base);
  const back = `${base}/urun/${id.data}`;
  const number = (key: string) => parseDecimal(text(form, key, 40));
  const [list, discount, stock, wasList, wasDiscount, wasStock] = ["listPrice", "discount", "stock", "was_listPrice", "was_discount", "was_stock"].map(number);
  const image = imageLink(text(form, "imageUrl", 2000));
  const input = z.object({
    list: z.number().positive().refine(value => Number(value.toFixed(4)) === value).nullable(),
    discount: z.number().min(0).max(100).nullable(),
    stock: z.number().int().min(0).nullable(),
  }).refine(value => value.list !== null || value.discount === null).safeParse({ list, discount, stock });
  if (!input.success || image.ignored) redirect(`${back}?error=input`, RedirectType.replace);
  const values = input.data;
  // A hidden value the form did not produce (tampered) counts as changed.
  const was = (value: number | null | "invalid") => typeof value === "number" ? value : null;
  const shownList = was(wasList);
  const pricing = edited(values.list === null ? null : { list: values.list, discount: values.discount ?? 0 },
    shownList === null ? null : { list: shownList, discount: was(wasDiscount) ?? 0 },
    (a, b) => a.list === b.list && a.discount === b.discount);
  let error = "", detail = "", changed = false;
  try {
    ({ changed } = await updateManualItem(db, id.data, {
      pricing, stock: edited(values.stock, was(wasStock), (a, b) => a === b),
      barcode: text(form, "barcode", 40)?.replace(/\s/g, "") ?? null, description: text(form, "description", 3000),
      viscosity: normalizeViscosity(text(form, "viscosity", 60)), package: normalizePackage(text(form, "package", 60)),
      approvals: text(form, "approvals", 1000), imageUrl: image.url,
    }, admin.id));
  } catch (cause) {
    if (!(cause instanceof ManualImportError)) throw cause;
    error = cause.reason; detail = cause.detail ?? "";
  }
  revalidatePath(base);
  revalidatePath(back);
  // Price and stock show on every storefront listing.
  if (changed) revalidatePath("/", "layout");
  // Replace, not push: in the list's product dialog a pushed entry would make closing (router.back) land on the
  // unsaved product URL with the dialog gone.
  redirect(`${back}?${new URLSearchParams(error ? { error, ...(detail ? { detail } : {}) } : { saved: "1" })}`, RedirectType.replace);
}
