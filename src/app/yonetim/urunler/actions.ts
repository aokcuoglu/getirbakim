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

// Undo a manual decision (split or merge) for one row: it rejoins its own key's product, and the store regroups at once.
export async function undoSplitSource(form: FormData) {
  await requireAdmin();
  const data = input.safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const target = (await db.query<{ id: string | null }>(`SELECT product_reset_item(supplier_item_id) AS id FROM product_sources
    WHERE supplier_item_id=$1 AND product_id=$2 AND method='manual'`, [data.data.item_id, data.data.product_id])).rows[0]?.id;
  revalidatePath("/yonetim/urunler");
  // Stay on the product while it still has rows; an emptied split product hands over to the row's own product.
  const remaining = (await db.query("SELECT 1 FROM product_sources WHERE product_id=$1 LIMIT 1", [data.data.product_id])).rowCount;
  redirect(!target ? `/yonetim/urunler/${data.data.product_id}?error=split` : remaining ? `/yonetim/urunler/${data.data.product_id}?reset=${target}` : `/yonetim/urunler/${target}?joined=1`);
}

/**
 * The two products are the same: one keeps its identity and takes every row of the other (locked). Başbuğ is the
 * main catalog, so a product sold by Başbuğ survives; otherwise the product being viewed does.
 */
export async function mergeProducts(form: FormData) {
  const admin = await requireAdmin();
  const data = z.object({ product_id: z.uuid(), other_id: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const { product_id, other_id } = data.data;
  const client = await db.connect();
  let target: string | null = null;
  try {
    await client.query("BEGIN");
    const rows = (await client.query<{ id: string; basbug: boolean }>("SELECT id,'basbug'=ANY(suppliers) AS basbug FROM products WHERE id=ANY($1::uuid[])",
      [[product_id, other_id]])).rows;
    const other = rows.find(row => row.id === other_id), self = rows.find(row => row.id === product_id);
    if (other && self) {
      const [keep, drop] = other.basbug && !self.basbug ? [other_id, product_id] : [product_id, other_id];
      target = (await client.query<{ id: string | null }>("SELECT product_merge($1,$2,$3) AS id", [drop, keep, admin.id])).rows[0].id;
      // Recorded like a reviewed candidate so the pair is not suggested again.
      if (target) await client.query(`INSERT INTO product_match_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'same',$3)
        ON CONFLICT (product_a,product_b) DO UPDATE SET status='same',decided_by=excluded.decided_by,decided_at=now()`, [keep, drop, admin.id]);
      await client.query("DELETE FROM product_match_candidates WHERE (product_a,product_b) IN (($1,$2),($2,$1))", [keep, drop]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urunler");
  redirect(target ? `/yonetim/urunler/${target}?merged=1` : `/yonetim/urunler/${product_id}?error=merge`);
}
