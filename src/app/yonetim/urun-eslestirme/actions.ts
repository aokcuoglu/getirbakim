"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sharedCandidateSql } from "@/modules/admin/product-matching-sql";

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

// Undo a manual decision (split or merge): the row rejoins its own key's product and the store regroups at once.
export async function undoSplit(form: FormData) {
  await requireAdmin();
  const input = z.object({ item_id: z.uuid(), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=same&error=input");
  await db.query("SELECT product_reset_item($1)", [input.data.item_id]);
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(input.data.back, "split=undone"));
}

const candidateInput = z.object({ product_a: z.uuid(), product_b: z.uuid(), status: z.enum(["same", "different"]), back: backPath });

// "Aynı ürün" merges the Dinamik product into the Başbuğ one (locked); "Farklı" only records the decision.
export async function decideCandidate(form: FormData) {
  const admin = await requireAdmin();
  const input = candidateInput.safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=candidates&error=input");
  const { product_a, product_b, status, back } = input.data;
  const client = await db.connect();
  let failed = false;
  try {
    await client.query("BEGIN");
    // No merge (the Dinamik product already sits elsewhere) leaves nothing to record.
    if (status === "same" && !(await client.query<{ id: string | null }>("SELECT product_merge($2,$1,$3) AS id", [product_a, product_b, admin.id])).rows[0].id) {
      await client.query("ROLLBACK");
      failed = true;
    } else {
      await client.query(`INSERT INTO product_match_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,$3,$4)
        ON CONFLICT (product_a,product_b) DO UPDATE SET status=excluded.status,decided_by=excluded.decided_by,decided_at=now()`, [product_a, product_b, status, admin.id]);
      // A Dinamik product joins one Başbuğ product; its other suggestions are dropped (not decided: they return if the
      // merge is undone from the product page).
      await client.query(`DELETE FROM product_match_candidates WHERE product_b=$2 AND (product_a=$1 OR $3)`, [product_a, product_b, status === "same"]);
      await client.query("COMMIT");
    }
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back, failed ? "error=merge" : `matched=${status}`));
}

// Accept every candidate of one brand and reason at once (systematic code formats such as CONTITECH "CT 978K1").
export async function acceptCandidates(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ reason: z.enum(["prefix", "leading_zero", "suffix"]), brand: z.string().regex(/^[A-Z0-9]{2,80}$/), back: backPath })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=candidates&error=input");
  const { reason, brand, back } = input.data;
  const client = await db.connect();
  let merged = 0;
  try {
    await client.query("BEGIN");
    const pairs = (await client.query<{ product_a: string; product_b: string }>(`SELECT c.product_a,c.product_b FROM product_match_candidates c
      JOIN products a ON a.id=c.product_a WHERE c.reason=$1 AND a.brand=$2 AND c.name_conflict IS NOT TRUE
      AND NOT ${sharedCandidateSql} LIMIT 500`, [reason, brand])).rows;
    for (const pair of pairs) {
      // Skipped when nothing merged; the pair stays in the list for a decision by hand.
      if (!(await client.query<{ id: string | null }>("SELECT product_merge($2,$1,$3) AS id", [pair.product_a, pair.product_b, admin.id])).rows[0].id) continue;
      await client.query(`INSERT INTO product_match_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'same',$3)
        ON CONFLICT (product_a,product_b) DO UPDATE SET status='same',decided_by=excluded.decided_by,decided_at=now()`, [pair.product_a, pair.product_b, admin.id]);
      await client.query("DELETE FROM product_match_candidates WHERE product_a=$1 AND product_b=$2", [pair.product_a, pair.product_b]);
      merged++;
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back.replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, ""), `matched=bulk&count=${merged}`));
}

// Record every listed name-conflict candidate as different (a reviewed "Tanımı farklı" list); nothing is merged.
export async function rejectCandidates(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ reason: z.enum(["prefix", "leading_zero", "suffix"]).optional(), q: z.string().regex(/^[A-Z0-9]{1,80}$/).optional(), back: backPath })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=candidates&error=input");
  const { reason, q, back } = input.data;
  // Same filter as the list (modules/admin/product-matching matchCandidates).
  const rejected = (await db.query(`WITH listed AS (
      SELECT c.product_a,c.product_b FROM product_match_candidates c JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b
      WHERE c.name_conflict AND ($1::text IS NULL OR c.reason=$1)
       AND ($2::text IS NULL OR a.brand=$2 OR a.part_number LIKE '%'||$2||'%' OR b.part_number LIKE '%'||$2||'%')
    ), decided AS (
      INSERT INTO product_match_decisions(product_a,product_b,status,decided_by) SELECT product_a,product_b,'different',$3 FROM listed
      ON CONFLICT (product_a,product_b) DO UPDATE SET status='different',decided_by=excluded.decided_by,decided_at=now()
    )
    DELETE FROM product_match_candidates c USING listed l WHERE c.product_a=l.product_a AND c.product_b=l.product_b`,
    [reason ?? null, q ?? null, admin.id])).rowCount ?? 0;
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back.replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, ""), `matched=bulk-different&count=${rejected}`));
}

const brandBack = z.string().regex(/^\/yonetim\/urun-eslestirme(\?.*)?$/).catch("/yonetim/urun-eslestirme");
const brandName = z.string().trim().min(1).max(80);
// A master brand by what an admin typed: its exact name, its key, or the brand a label of that spelling belongs to.
const findBrand = `SELECT id FROM (
  SELECT id,0 AS rank FROM brands WHERE upper(name)=upper(trim($1)) UNION ALL SELECT id,1 FROM brands WHERE key=product_brand_key($1)
  UNION ALL SELECT b.id,2 FROM brand_key_aliases a JOIN brands b ON b.key=a.canonical WHERE a.alias=product_brand_key($1)) x ORDER BY rank LIMIT 1`;

async function brandDecision(back: string, flag: string, run: (client: import("pg").PoolClient) => Promise<boolean>) {
  const client = await db.connect();
  let done = false;
  try {
    await client.query("BEGIN");
    done = await run(client);
    await client.query(done ? "COMMIT" : "ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back, done ? `brand=${flag}` : "error=brand"));
}

// "Onayla": the brand's automatically placed labels are confirmed as they are.
export async function confirmBrand(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ id: z.coerce.number().int().positive(), back: brandBack }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?error=input");
  await brandDecision(input.data.back, "confirmed", async client => {
    await client.query("UPDATE supplier_brands SET method='manual',decided_by=$2,decided_at=now() WHERE brand_id=$1 AND method='auto'", [input.data.id, admin.id]);
    return true;
  });
}

// Display name only; the key products group by stays.
export async function renameBrand(form: FormData) {
  await requireAdmin();
  const input = z.object({ id: z.coerce.number().int().positive(), name: brandName, back: brandBack }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?error=input");
  await brandDecision(input.data.back, "renamed", async client =>
    (await client.query("UPDATE brands SET name=upper($2),updated_at=now() WHERE id=$1", [input.data.id, input.data.name])).rowCount === 1);
}

// One supplier label moves to another master brand ("move"), or becomes a master brand of its own ("new"). A brand
// left without labels is removed. Products regroup on the next refresh.
export async function moveBrandLabel(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ supplier: z.enum(["basbug", "dinamik", "seta"]), label: z.string().min(1).max(120), mode: z.enum(["move", "new"]),
    target: z.string().trim().max(80).optional(), back: brandBack }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?error=input");
  const { supplier, label, mode, target, back } = input.data;
  await brandDecision(back, mode === "new" ? "created" : "moved", async client => {
    await client.query("SELECT pg_advisory_xact_lock(20261001,7)");
    const current = (await client.query<{ brand_id: string }>("SELECT brand_id FROM supplier_brands WHERE supplier=$1 AND label=$2", [supplier, label])).rows[0];
    if (!current || (mode === "move" && !target)) return false;
    const brand = mode === "new" ? (await client.query<{ id: string | null }>("SELECT brand_create($1) AS id", [label])).rows[0]?.id
      : (await client.query<{ id: string }>(findBrand, [target])).rows[0]?.id;
    if (!brand) return false;
    await client.query("UPDATE supplier_brands SET brand_id=$3,method='manual',decided_by=$4,decided_at=now() WHERE supplier=$1 AND label=$2", [supplier, label, brand, admin.id]);
    await client.query("DELETE FROM brands b WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM supplier_brands s WHERE s.brand_id=b.id)", [current.brand_id]);
    return true;
  });
}

// Every label of this brand joins the target brand, which keeps its name and key.
export async function mergeBrand(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ id: z.coerce.number().int().positive(), target: brandName, back: brandBack }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?error=input");
  await brandDecision(input.data.back, "merged", async client => {
    const target = (await client.query<{ id: string }>(findBrand, [input.data.target])).rows[0]?.id;
    return Boolean(target) && (await client.query("SELECT brand_merge($1,$2,$3) AS id", [input.data.id, target, admin.id])).rows[0].id !== null;
  });
}
