"use server";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bulkAcceptableSql, bulkCandidateReasons } from "@/modules/admin/product-matching-sql";
// Actions that regroup offers clear the "Eşleşenler" groups cached in this process at once; other app processes see
// it through product_grouping_version. Brand and reject decisions do not regroup. A successful supplier import
// re-keys the cache; other price changes (markup/VAT settings, stale rows) reach it within 60 s.
import { forgetSameProducts } from "@/modules/admin/product-matching";
import { matchingBack, safeMatchingBack, withMatchingFlag } from "@/modules/admin/product-matching-back";
import { invalidateListings } from "@/modules/store/listing-epoch";

export async function refreshMatches(form: FormData) {
  await requireAdmin();
  const back = safeMatchingBack(form.get("back"));
  let error = "";
  try { await db.query("SELECT refresh_product_matches()"); }
  catch { error = "refresh"; }
  forgetSameProducts();
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withMatchingFlag(back, error ? `error=${error}` : "refreshed=1"));
}

const backPath = matchingBack;
const withFlag = withMatchingFlag;

// "Ayır" on one offer of a group (#523): only that row leaves; a hand-merged row returns to its own key's product, an
// automatically grouped one becomes a locked product of its own. The pair is recorded as different (db
// product_split_offer). `primary_id` is the group the form was shown for: NULL when the row is no longer a non-primary
// offer of it (a refresh, another admin or an earlier click got there first).
export async function splitOffer(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ item_id: z.uuid(), primary_id: z.uuid(), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=same&error=input");
  const { item_id, primary_id, back } = input.data;
  const { id } = (await db.query<{ id: string | null }>("SELECT product_split_offer($1,$2,$3) AS id", [item_id, primary_id, admin.id])).rows[0];
  // The store lists the row on its own now: cached listings and searches reload (#585).
  if (id) await invalidateListings();
  forgetSameProducts();
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back, id ? "split=1" : "error=split"));
}

// Undo a manual decision (split or merge): the row rejoins its own key's product and the store regroups at once.
export async function undoSplit(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ item_id: z.uuid(), back: backPath }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=same&scope=manual&error=input");
  const { id } = (await db.query<{ id: string | null }>("SELECT product_reset_item($1,$2) AS id", [input.data.item_id, admin.id])).rows[0];
  // The store regroups the row: cached listings and searches reload (#585).
  if (id) await invalidateListings();
  forgetSameProducts();
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
  let failed = false, carriedHidden = false, carriedOem = false, carriedImages = 0, keptImages = false, carriedRefs = 0, carriedSpecs = 0, carriedFitments = 0;
  try {
    await client.query("BEGIN");
    // No merge (the Dinamik product already sits elsewhere) leaves nothing to record.
    // product_overrides_carry: the Başbuğ product takes the merged product's store edits where it has none, and its
    // hidden state (#575); the notice says when hidden was carried. Images (#581), reference numbers (#582),
    // specifications (#603) and vehicle fitments (#583) follow.
    const merge = status === "same" ? (await client.query<{ id: string | null; carried: { fields: string[]; hidden: boolean } | null; carried_images: { images: number; kept: boolean } | null;
      carried_refs: { added: number; hidden: number } | null; carried_specs: { set: number; hidden: number } | null;
      carried_fitments: { added: number; removed: number; hidden: number } | null }>(`WITH merged AS (SELECT product_merge($2,$1,$3) AS id)
      SELECT id, product_overrides_carry($2, id, $3) AS carried, product_override_images_carry($2, id, $3) AS carried_images,
       product_override_references_carry($2, id, $3) AS carried_refs, product_override_specs_carry($2, id, $3) AS carried_specs,
       product_override_fitments_carry($2, id, $3) AS carried_fitments FROM merged`, [product_a, product_b, admin.id])).rows[0] : null;
    carriedHidden = Boolean(merge?.carried?.hidden);
    carriedOem = Boolean(merge?.carried?.fields.includes("hide_supplier_oem"));
    carriedImages = merge?.carried_images?.images ?? 0;
    keptImages = Boolean(merge?.carried_images?.kept);
    carriedRefs = (merge?.carried_refs?.added ?? 0) + (merge?.carried_refs?.hidden ?? 0);
    carriedSpecs = (merge?.carried_specs?.set ?? 0) + (merge?.carried_specs?.hidden ?? 0);
    carriedFitments = (merge?.carried_fitments?.added ?? 0) + (merge?.carried_fitments?.removed ?? 0) + (merge?.carried_fitments?.hidden ?? 0);
    if (merge && !merge.id) {
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
  // Only a merge changes what the store lists (#585); "Farklı" records a decision.
  if (status === "same" && !failed) await invalidateListings();
  forgetSameProducts();
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back, failed ? "error=merge" : `matched=${status}${carriedHidden ? "&carried_hidden=1" : ""}${carriedOem ? "&carried_oem=1" : ""}${carriedImages ? `&images=${carriedImages}` : keptImages ? "&images=kept" : ""}${carriedRefs ? `&refs=${carriedRefs}` : ""}${carriedSpecs ? `&specs=${carriedSpecs}` : ""}${carriedFitments ? `&fitments=${carriedFitments}` : ""}`));
}

// Accept every candidate of one brand and reason at once (systematic code formats such as CONTITECH "CT 978K1"). Suffix
// pairs only with a reviewed safe ending (#535); other suffix pairs, name conflicts, shared Dinamik products and Başbuğ
// products with several numbers are left for a decision by hand (#524). bulkAcceptableSql is the rule, not the form.
export async function acceptCandidates(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ reason: z.enum(bulkCandidateReasons), brand: z.string().regex(/^[A-Z0-9]{2,80}$/), back: backPath })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?tab=candidates&error=input");
  const { reason, brand, back } = input.data;
  const client = await db.connect();
  let merged = 0, carriedHidden = 0, carriedOem = 0, carriedImages = 0, carriedRefs = 0, carriedSpecs = 0, carriedFitments = 0;
  try {
    await client.query("BEGIN");
    const pairs = (await client.query<{ product_a: string; product_b: string }>(`SELECT c.product_a,c.product_b FROM product_match_candidates c
      JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b
      WHERE c.reason=$1 AND a.brand=$2 AND ${bulkAcceptableSql} LIMIT 500`, [reason, brand])).rows;
    for (const pair of pairs) {
      // Skipped when nothing merged; the pair stays in the list for a decision by hand.
      const merge = (await client.query<{ id: string | null; carried: { fields: string[]; hidden: boolean } | null; carried_images: { images: number; kept: boolean } | null;
        carried_refs: { added: number; hidden: number } | null; carried_specs: { set: number; hidden: number } | null;
      carried_fitments: { added: number; removed: number; hidden: number } | null }>(`WITH merged AS (SELECT product_merge($2,$1,$3) AS id)
        SELECT id, product_overrides_carry($2, id, $3) AS carried, product_override_images_carry($2, id, $3) AS carried_images,
         product_override_references_carry($2, id, $3) AS carried_refs, product_override_specs_carry($2, id, $3) AS carried_specs,
       product_override_fitments_carry($2, id, $3) AS carried_fitments FROM merged`, [pair.product_a, pair.product_b, admin.id])).rows[0];
      if (!merge.id) continue;
      // A hidden product merged into a sellable one hides it too (#575); the summary counts them.
      if (merge.carried?.hidden) carriedHidden++;
      if (merge.carried?.fields.includes("hide_supplier_oem")) carriedOem++;
      carriedImages += merge.carried_images?.images ?? 0;
      carriedRefs += (merge.carried_refs?.added ?? 0) + (merge.carried_refs?.hidden ?? 0);
      carriedSpecs += (merge.carried_specs?.set ?? 0) + (merge.carried_specs?.hidden ?? 0);
      carriedFitments += (merge.carried_fitments?.added ?? 0) + (merge.carried_fitments?.removed ?? 0) + (merge.carried_fitments?.hidden ?? 0);
      await client.query(`INSERT INTO product_match_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'same',$3)
        ON CONFLICT (product_a,product_b) DO UPDATE SET status='same',decided_by=excluded.decided_by,decided_at=now()`, [pair.product_a, pair.product_b, admin.id]);
      await client.query("DELETE FROM product_match_candidates WHERE product_a=$1 AND product_b=$2", [pair.product_a, pair.product_b]);
      merged++;
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  // One bump for the whole batch (#585).
  if (merged > 0) await invalidateListings();
  forgetSameProducts();
  revalidatePath("/yonetim/urun-eslestirme");
  redirect(withFlag(back.replace(/([?&])q=[^&]*&?/, "$1").replace(/[?&]$/, ""), `matched=bulk&count=${merged}&carried_hidden=${carriedHidden}&carried_oem=${carriedOem}&images=${carriedImages}&refs=${carriedRefs}&specs=${carriedSpecs}&fitments=${carriedFitments}`));
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

const brandBack = matchingBack;
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
  const input = z.object({ supplier: z.enum(["basbug", "dinamik", "seta", "manual"]), label: z.string().min(1).max(120), mode: z.enum(["move", "new"]),
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

// Every label of this brand joins the target brand, which keeps its name and key. The target is what an admin typed,
// or the suggested brand's id (names are not unique).
export async function mergeBrand(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ id: z.coerce.number().int().positive(), back: brandBack }).and(z.union([
    z.object({ targetId: z.coerce.number().int().positive() }), z.object({ target: brandName }),
  ])).safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/yonetim/urun-eslestirme?error=input");
  const data = input.data;
  await brandDecision(data.back, "merged", async client => {
    const target = "targetId" in data ? (await client.query<{ id: string }>("SELECT id FROM brands WHERE id=$1", [data.targetId])).rows[0]?.id
      : (await client.query<{ id: string }>(findBrand, [data.target])).rows[0]?.id;
    return Boolean(target) && (await client.query("SELECT brand_merge($1,$2,$3) AS id", [input.data.id, target, admin.id])).rows[0].id !== null;
  });
}
