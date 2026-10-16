"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";

const path = "/yonetim/arac-gorselleri";
const backPath = z.string().regex(/^\/yonetim\/arac-gorselleri(\?.*)?$/).catch(path);
const withFlag = (back: string, flag: string) => `${back}${back.includes("?") ? "&" : "?"}${flag}`;

/** Approve or reject one series photograph; only approved rows reach the store. */
export async function reviewVehicleImage(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ model_id: z.coerce.number().int().positive(), status: z.enum(["approved", "rejected", "pending"]), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect(withFlag(path, "error=input"));
  const { model_id, status, back } = input.data;
  await db.query("UPDATE vehicle_model_images SET status=$2, reviewed_at=CASE WHEN $2='pending' THEN NULL ELSE now() END, reviewed_by=CASE WHEN $2='pending' THEN NULL ELSE $3::uuid END WHERE model_id=$1",
    [model_id, status, admin.id]);
  revalidatePath(path);
  redirect(withFlag(back, `reviewed=${status}`));
}

/** Publish every pending generation-level match at once (optionally one brand): the item names the series itself. */
export async function approveGenerationMatches(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ brand: z.string().trim().max(80).optional(), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect(withFlag(path, "error=input"));
  const { brand, back } = input.data;
  const result = await db.query(`UPDATE vehicle_model_images i SET status='approved', reviewed_at=now(), reviewed_by=$1 FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE m.id=i.model_id AND i.status='pending' AND i.match_kind='generation' AND ($2::text IS NULL OR b.display_name=$2)`, [admin.id, brand || null]);
  revalidatePath(path);
  redirect(withFlag(back, `approved=${result.rowCount ?? 0}`));
}
