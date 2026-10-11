"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const decision = z.object({
  brand_a: z.string().min(1).max(120), brand_b: z.string().min(1).max(120),
  status: z.enum(["same", "equivalent", "unrelated"]), back: z.string().regex(/^\/yonetim\/urun-eslestirme(\?.*)?$/).catch("/yonetim/urun-eslestirme"),
}).refine(value => value.brand_a < value.brand_b);

// Decisions apply to the brand pair. "same" adds an alias towards the brand with more items; grouping changes on the
// next refresh (refreshMatches), the suggestion disappears at once.
export async function decideBrandPair(form: FormData) {
  const admin = await requireAdmin();
  const input = decision.safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?error=input");
  const { brand_a, brand_b, status, back } = input.data;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO product_brand_pair_decisions(brand_a,brand_b,status,decided_by) VALUES($1,$2,$3,$4)
      ON CONFLICT(brand_a,brand_b) DO UPDATE SET status=EXCLUDED.status,decided_by=EXCLUDED.decided_by,decided_at=now()`, [brand_a, brand_b, status, admin.id]);
    if (status === "same") {
      const counts = (await client.query<{ brand: string; count: number }>(
        "SELECT brand,count(*)::int FROM product_match_items WHERE brand=ANY($1) GROUP BY brand", [[brand_a, brand_b]])).rows;
      const size = (brand: string) => counts.find(row => row.brand === brand)?.count ?? 0;
      const [canonical, alias] = size(brand_a) >= size(brand_b) ? [brand_a, brand_b] : [brand_b, brand_a];
      // Keep aliases one hop deep: anything that pointed at the alias now points at the canonical brand.
      await client.query("UPDATE product_brand_aliases SET canonical=$2,decided_by=$3,decided_at=now() WHERE canonical=$1", [alias, canonical, admin.id]);
      await client.query(`INSERT INTO product_brand_aliases(alias,canonical,decided_by) VALUES($1,$2,$3)
        ON CONFLICT(alias) DO UPDATE SET canonical=EXCLUDED.canonical,decided_by=EXCLUDED.decided_by,decided_at=now()`, [alias, canonical, admin.id]);
    }
    await client.query("DELETE FROM product_brand_pair_suggestions WHERE brand_a=$1 AND brand_b=$2", [brand_a, brand_b]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(`${back}${back.includes("?") ? "&" : "?"}decided=${status}`);
}

export async function refreshMatches() {
  await requireAdmin();
  let error = "";
  try { await db.query("SELECT refresh_product_matches()"); }
  catch { error = "refresh"; }
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(`/yonetim/urun-eslestirme?${error ? `error=${error}` : "refreshed=1"}`);
}

const backPath = z.string().regex(/^\/yonetim\/urun-eslestirme(\?.*)?$/).catch("/yonetim/urun-eslestirme");
const withFlag = (back: string, flag: string) => `${back}${back.includes("?") ? "&" : "?"}${flag}`;

// "Ayır": the group's other rows become products of their own (locked manual sources), listed on their own at once.
export async function splitOffers(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ primary_id: z.uuid(), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=same&error=input");
  const { primary_id, back } = input.data;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT product_split_item(item_id,$2) FROM product_offers WHERE primary_id=$1 AND item_id<>primary_id",
      [primary_id, admin.id]);
    await client.query("DELETE FROM product_offers WHERE primary_id=$1", [primary_id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back, "split=1"));
}

// The row rejoins its key's product at once; the store groups it again after the next refresh.
export async function undoSplit(form: FormData) {
  await requireAdmin();
  const input = z.object({ item_id: z.uuid(), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=same&error=input");
  await db.query("SELECT product_unsplit_item($1)", [input.data.item_id]);
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(input.data.back, "split=undone"));
}
