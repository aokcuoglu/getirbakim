"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { forgetSameProducts } from "@/modules/admin/product-matching";
import { productCardFields, productOverrideIdSchema, productOverrideValuesSchema, productPriceValuesSchema, priceText,
  type ProductCardValues, type ProductOverrideResult, type ProductPriceResult, type ProductPriceValues } from "@/modules/admin/product-override-schema";
import type { ProductOverrideField } from "@/modules/admin/product-override-fields";
import { belowCostSources, persistProductOverride } from "@/modules/admin/product-override-store";
import { requireAdmin } from "@/modules/auth/session";
import { invalidateListings } from "@/modules/store/listing-epoch";

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
  // The store lists the row on its own now: cached listings and searches reload (#585).
  if (created) await invalidateListings();
  // Regrouped offers: the matching page's cached groups are stale.
  forgetSameProducts();
  revalidatePath("/yonetim/urunler");
  redirect(created ? `/yonetim/urunler/${product_id}?split=${created}` : `/yonetim/urunler/${product_id}?error=split`);
}

// Undo a manual decision (split or merge) for one row: it rejoins its own key's product, and the store regroups at once.
export async function undoSplitSource(form: FormData) {
  const admin = await requireAdmin();
  const data = input.safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const target = (await db.query<{ id: string | null }>(`SELECT product_reset_item(supplier_item_id,$3) AS id FROM product_sources
    WHERE supplier_item_id=$1 AND product_id=$2 AND method='manual'`, [data.data.item_id, data.data.product_id, admin.id])).rows[0]?.id;
  // The store regroups the row: cached listings and searches reload (#585).
  if (target) await invalidateListings();
  // Regrouped offers: the matching page's cached groups are stale.
  forgetSameProducts();
  revalidatePath("/yonetim/urunler");
  // Stay on the product while it still has rows; an emptied split product hands over to the row's own product.
  const remaining = (await db.query("SELECT 1 FROM product_sources WHERE product_id=$1 LIMIT 1", [data.data.product_id])).rowCount;
  redirect(!target ? `/yonetim/urunler/${data.data.product_id}?error=split` : remaining ? `/yonetim/urunler/${data.data.product_id}?reset=${target}` : `/yonetim/urunler/${target}?joined=1`);
}

/** `&images=<n>` (uploads copied by the merge) or `&images=kept` (the kept product's own uploads stayed), else nothing. */
const imageCarryFlag = (carried: { images: number; kept: boolean } | null | undefined) =>
  carried?.images ? `&images=${carried.images}` : carried?.kept ? "&images=kept" : "";

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
  let target: string | null = null, carriedHidden = false, oemFlag = "", imagesFlag = "", refsFlag = "", specsFlag = "", fitmentsFlag = "";
  try {
    await client.query("BEGIN");
    const rows = (await client.query<{ id: string; basbug: boolean }>("SELECT id,'basbug'=ANY(suppliers) AS basbug FROM products WHERE id=ANY($1::uuid[])",
      [[product_id, other_id]])).rows;
    const other = rows.find(row => row.id === other_id), self = rows.find(row => row.id === product_id);
    if (other && self) {
      const [keep, drop] = other.basbug && !self.basbug ? [other_id, product_id] : [product_id, other_id];
      target = (await client.query<{ id: string | null }>("SELECT product_merge($1,$2,$3) AS id", [drop, keep, admin.id])).rows[0].id;
      // The kept product takes the merged product's store edits (hidden and a hidden supplier OEM field included, #615)
      // when it has none of its own (#575).
      if (target) {
        const carried = (await client.query<{ carried: { fields: string[]; hidden: boolean } }>("SELECT product_overrides_carry($1,$2,$3) AS carried",
          [drop, target, admin.id])).rows[0].carried;
        carriedHidden = carried.hidden;
        if (carried.fields.includes("hide_supplier_oem")) oemFlag = "&oem=hidden";
      }
      // Uploaded images and a hidden automatic image as well (#581).
      if (target) imagesFlag = imageCarryFlag((await client.query<{ carried: { images: number; kept: boolean } }>("SELECT product_override_images_carry($1,$2,$3) AS carried",
        [drop, target, admin.id])).rows[0].carried);
      // Hand-entered reference numbers (#582); the kept product's own row wins for the same number.
      if (target) {
        const refs = (await client.query<{ carried: { added: number; hidden: number } }>("SELECT product_override_references_carry($1,$2,$3) AS carried",
          [drop, target, admin.id])).rows[0].carried;
        if (refs.added + refs.hidden > 0) refsFlag = `&refs=${refs.added + refs.hidden}`;
        // Hand-entered technical specifications (#603); the kept product's own row wins for the same key.
        const specs = (await client.query<{ carried: { set: number; hidden: number } }>("SELECT product_override_specs_carry($1,$2,$3) AS carried",
          [drop, target, admin.id])).rows[0].carried;
        if (specs.set + specs.hidden > 0) specsFlag = `&specs=${specs.set + specs.hidden}`;
        // Added and removed vehicle fitments (#583); the kept product's own decision wins for the same type.
        const fitments = (await client.query<{ carried: { added: number; removed: number } }>("SELECT product_override_fitments_carry($1,$2,$3) AS carried",
          [drop, target, admin.id])).rows[0].carried;
        if (fitments.added + fitments.removed > 0) fitmentsFlag = `&fitments=${fitments.added + fitments.removed}`;
      }
      // Recorded like a reviewed candidate so the pair is not suggested again.
      if (target) await client.query(`INSERT INTO product_match_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'same',$3)
        ON CONFLICT (product_a,product_b) DO UPDATE SET status='same',decided_by=excluded.decided_by,decided_at=now()`, [keep, drop, admin.id]);
      await client.query("DELETE FROM product_match_candidates WHERE (product_a,product_b) IN (($1,$2),($2,$1))", [keep, drop]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  // The merged products list as one, with the carried edits: cached listings and searches reload (#585).
  if (target) await invalidateListings();
  // Regrouped offers: the matching page's cached groups are stale.
  forgetSameProducts();
  revalidatePath("/yonetim/urunler");
  redirect(target ? `/yonetim/urunler/${target}?merged=${carriedHidden ? "hidden" : "1"}${oemFlag}${imagesFlag}${refsFlag}${specsFlag}${fitmentsFlag}` : `/yonetim/urunler/${product_id}?error=merge`);
}

const pair = z.object({ product_id: z.uuid(), other_id: z.uuid() }).refine(data => data.product_id !== data.other_id);

/**
 * Not the same product but usable instead (another brand of the same size): an equivalent decision kept across
 * refreshes. The link shows at once; the next refresh keeps it only while no rule ties the pair.
 */
export async function linkEquivalent(form: FormData) {
  const admin = await requireAdmin();
  const data = pair.safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const { product_id, other_id } = data.data;
  const client = await db.connect();
  let linked = false;
  try {
    await client.query("BEGIN");
    const products = (await client.query<{ id: string; brand_label: string; part_number: string }>(
      "SELECT id,brand_label,part_number FROM products WHERE id=ANY($1::uuid[]) AND merged_into IS NULL", [[product_id, other_id]])).rows;
    if (products.length === 2) {
      const [a, b] = [product_id, other_id].sort();
      await client.query(`INSERT INTO product_equivalent_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'equivalent',$3)
        ON CONFLICT (product_a,product_b) DO UPDATE SET status='equivalent',decided_by=excluded.decided_by,decided_at=now()`, [a, b, admin.id]);
      for (const self of products) {
        const other = products.find(row => row.id !== self.id)!;
        await client.query(`INSERT INTO product_equivalents(product_id,equivalent_id,kind,brand,part_number) VALUES($1,$2,'manual',$3,$4)
          ON CONFLICT (product_id,equivalent_id) DO NOTHING`, [self.id, other.id, other.brand_label, other.part_number]);
      }
      linked = true;
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath(`/yonetim/urunler/${product_id}`);
  redirect(linked ? `/yonetim/urunler/${product_id}?linked=1#muadil` : `/yonetim/urunler/${product_id}?error=link#muadil`);
}

// Remove an equivalent: a hand-made link is forgotten, an automatic one is recorded as unrelated so refreshes skip it.
export async function unlinkEquivalent(form: FormData) {
  const admin = await requireAdmin();
  const data = pair.safeParse(Object.fromEntries(form));
  if (!data.success) redirect("/yonetim/urunler?error=input");
  const { product_id, other_id } = data.data;
  const [a, b] = [product_id, other_id].sort();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const kind = (await client.query<{ kind: string }>("SELECT kind FROM product_equivalents WHERE product_id=$1 AND equivalent_id=$2",
      [product_id, other_id])).rows[0]?.kind;
    if (kind === "manual") await client.query("DELETE FROM product_equivalent_decisions WHERE product_a=$1 AND product_b=$2", [a, b]);
    else if (kind) await client.query(`INSERT INTO product_equivalent_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'unrelated',$3)
      ON CONFLICT (product_a,product_b) DO UPDATE SET status='unrelated',decided_by=excluded.decided_by,decided_at=now()`, [a, b, admin.id]);
    await client.query("DELETE FROM product_equivalents WHERE (product_id,equivalent_id) IN (($1::uuid,$2::uuid),($2::uuid,$1::uuid))", [product_id, other_id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  revalidatePath(`/yonetim/urunler/${product_id}`);
  redirect(`/yonetim/urunler/${product_id}?unlinked=1#muadil`);
}

const overrideFailures = {
  "not-found": "Ürün bulunamadı. Sayfayı yenileyin.",
  merged: "Bu ürün başka bir ürünle birleştirildi; düzenlemeyi birleştirilen üründe yapın.",
  category: "Seçilen kategori bulunamadı. Listeden yeniden seçin.",
  brand: "Seçilen marka bulunamadı. Listeden yeniden seçin.",
  stale: "Bu ürün siz düzenlerken başka bir sekmede veya kullanıcı tarafından değiştirildi. Sayfayı yenileyip yeniden deneyin.",
  "sale-expired": "Kampanya bitişi geçmişte kalıyor. Bitişi ileri alın ya da kampanyayı kaldırın.",
} as const;

const listingFields = new Set<ProductOverrideField>(["name", "description", "category_id", "hidden", "brand", "part_number"]);

/**
 * Store card edits (#575): "save" stores every field of the form, "reset" returns one field to its automatic value.
 * Both carry the version the form was opened with, so a stale form cannot overwrite a newer save. Supplier syncs and
 * enrichment never write these values; the store reads them at once, cached listings and searches through the listing
 * epoch (#585).
 */
export async function saveProductOverride(_previous: ProductOverrideResult, form: FormData): Promise<ProductOverrideResult> {
  const admin = await requireAdmin();
  const id = productOverrideIdSchema.safeParse(form.get("id"));
  const version = form.get("version");
  if (!id.success || typeof version !== "string" || !/^(auto|\d{1,20})$/.test(version)) return { status: "error", message: "Ürün tanınmadı. Sayfayı yenileyin." };
  const resetValue = form.get("reset");
  const reset = typeof resetValue === "string" && resetValue ? productCardFields.find(field => field === resetValue) : undefined;
  if (typeof resetValue === "string" && resetValue && !reset) return { status: "error", message: "Alan tanınmadı. Yeniden deneyin." };
  let patch: Partial<ProductCardValues>;
  if (reset) patch = reset === "hidden" ? { hidden: false } : { [reset]: null };
  else {
    const input = productOverrideValuesSchema.safeParse({
      name: form.get("name") ?? "", description: form.get("description") ?? "", seo_title: form.get("seo_title") ?? "",
      seo_description: form.get("seo_description") ?? "", category_id: form.get("category_id") ?? "", published: form.get("published") ?? undefined,
      brand: form.get("brand") ?? "", part_number: form.get("part_number") ?? "",
    });
    if (!input.success) return { status: "error", message: input.error.issues[0]?.message ?? "Alanları kontrol edin." };
    patch = input.data;
  }
  let result: Awaited<ReturnType<typeof persistProductOverride>>;
  try {
    result = await persistProductOverride(db, id.data, patch, admin.id, version);
  } catch {
    return { status: "error", message: "Değişiklikler kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: overrideFailures[result.reason] };
  const saved = { values: result.values, version: result.version, reset };
  if (!result.changed.length) return { status: "success", message: "Değişiklik yok; kayıtlı değerler aynı.", ...saved };
  // Fields a listing, a category page or a search shows; SEO text only reaches the product page (#585).
  if (result.changed.some(field => listingFields.has(field))) await invalidateListings();
  // The store's product page, listings and search, and this admin page: every page may show the product.
  revalidatePath("/", "layout");
  return { status: "success", message: reset ? "Alan otomatik değere döndü." : "Mağaza bilgileri kaydedildi.", ...saved };
}

/** The form's version: a stored edit's microseconds or "auto". */
const versionPattern = /^(auto|\d{1,20})$/;

/**
 * The product's fixed price and campaign (#580). "save" stores the four fields of the form; reset "price_kurus" drops
 * the fixed price, reset "sale_price_kurus" drops the campaign with its window. A price below a source's VAT-included
 * cost is saved and answered with a warning (the admin's decision). The catalog prices every source of the product
 * from it at once; a source the formula cannot price (missing cost, rate or freshness) stays off sale.
 */
export async function saveProductPrice(_previous: ProductPriceResult, form: FormData): Promise<ProductPriceResult> {
  const admin = await requireAdmin();
  const id = productOverrideIdSchema.safeParse(form.get("id"));
  const version = form.get("version");
  if (!id.success || typeof version !== "string" || !versionPattern.test(version)) return { status: "error", message: "Ürün tanınmadı. Sayfayı yenileyin." };
  const resetValue = form.get("reset");
  const reset = (["price_kurus", "sale_price_kurus"] as const).find(field => field === resetValue);
  if (typeof resetValue === "string" && resetValue && !reset) return { status: "error", message: "Alan tanınmadı. Yeniden deneyin." };
  let patch: Partial<ProductPriceValues>;
  if (reset === "price_kurus") patch = { price_kurus: null };
  else if (reset === "sale_price_kurus") patch = { sale_price_kurus: null, sale_from: null, sale_until: null };
  else {
    const field = (name: string) => { const value = form.get(name); return typeof value === "string" ? value : ""; };
    const input = productPriceValuesSchema.safeParse({ price: field("price"), sale_price: field("sale_price"), sale_from: field("sale_from"), sale_until: field("sale_until") });
    if (!input.success) return { status: "error", message: input.error.issues[0]?.message ?? "Alanları kontrol edin." };
    patch = input.data;
  }
  let result: Awaited<ReturnType<typeof persistProductOverride>>;
  try {
    result = await persistProductOverride(db, id.data, patch, admin.id, version);
  } catch {
    return { status: "error", message: "Fiyat kaydedilemedi. Yeniden deneyin." };
  }
  if (!result.ok) return { status: "error", message: overrideFailures[result.reason] };
  const { price_kurus, sale_price_kurus, sale_from, sale_until } = result.values;
  const saved = { values: { price_kurus, sale_price_kurus, sale_from, sale_until }, version: result.version, reset };
  if (!result.changed.length) return { status: "success", message: "Değişiklik yok; kayıtlı değerler aynı.", ...saved };
  // The store's product page, listings, cart and this admin page: every page may show the price.
  revalidatePath("/", "layout");
  // A failed check must not hide the saved price: the warning is extra information.
  const below = await belowCostSources(db, id.data).catch(() => []);
  const warning = below.length ? `Satış fiyatı maliyetin altında: ${below.map(source =>
    `${source.code} ${priceText(source.price_kurus)} (KDV dahil maliyet ${priceText(source.cost_with_vat_kurus)})`).join("; ")}. Kayıt yapıldı; zararına satış olmaması için fiyatı kontrol edin.` : undefined;
  return { status: "success", message: reset === "price_kurus" ? "Sabit fiyat kaldırıldı; formül fiyatı uygulanıyor."
    : reset ? "Kampanya kaldırıldı." : "Fiyat kaydedildi.", warning, ...saved };
}
