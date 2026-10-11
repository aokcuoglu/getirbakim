"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";

const input = z.object({ item_id: z.uuid(), product_id: z.uuid() });

/**
 * A supplier row is not this product: it becomes a product of its own (locked), and the store lists it separately
 * at once. The storefront projection (product_offers) drops the row now instead of waiting for the next refresh.
 */
export async function splitSource(form: FormData) {
  const admin = await requireAdmin();
  const data = input.safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const { item_id, product_id } = data.data;
  const client = await db.connect();
  let created: string | null;
  try {
    await client.query("BEGIN");
    created = (await client.query<{ id: string | null }>(`SELECT product_split_item(s.supplier_item_id,$3) AS id FROM product_sources s
      WHERE s.supplier_item_id=$1 AND s.product_id=$2`, [item_id, product_id, admin.id])).rows[0]?.id ?? null;
    if (created) {
      const primary = (await client.query<{ primary_id: string }>("DELETE FROM product_offers WHERE item_id=$1 RETURNING primary_id", [item_id])).rows[0]?.primary_id;
      // A group left with one row is no longer a group.
      if (primary) await client.query(`DELETE FROM product_offers WHERE primary_id=$1 AND (SELECT count(*) FROM product_offers WHERE primary_id=$1)<2`, [primary]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urunler");
  redirect(created ? `/yonetim/urunler/${product_id}?split=${created}` : `/yonetim/urunler/${product_id}?error=split`);
}

// The row rejoins its key's automatic product; the store groups it again after the next refresh.
export async function undoSplitSource(form: FormData) {
  await requireAdmin();
  const data = input.safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const target = (await db.query<{ id: string | null }>(`SELECT product_unsplit_item(supplier_item_id) AS id FROM product_sources
    WHERE supplier_item_id=$1 AND product_id=$2 AND method='manual'`, [data.data.item_id, data.data.product_id])).rows[0]?.id;
  revalidatePath("/yonetim/urunler");
  redirect(target ? `/yonetim/urunler/${target}?joined=1` : `/yonetim/urunler/${data.data.product_id}?error=split`);
}
