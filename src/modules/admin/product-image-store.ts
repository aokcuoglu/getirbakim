import "server-only";
import type { Pool, PoolClient } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { siteUrl } from "@/lib/site";
import { storeProductImageBytes } from "@/modules/enrichment/import";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { prepareProductImage, ProductImageError, productImageLimits, type ProductImageErrorReason } from "./product-image-upload";

/** A product's gallery as the admin manages it (db/product-override-images.sql, #581). */
export type ProductImages = {
  /** The admin's uploads in store order; the first is the primary image. */
  images: { id: string; src: string; width: number; height: number; file_name: string; carried: boolean }[];
  hideAutomatic: boolean;
  /** Enrichment images the product's store rows show without uploads (one per media object). */
  automatic: {
    src: string; mediaId: string; width: number; height: number; supplier: string; inGallery: boolean;
    /** False: the row is not in the supplier's current list (pending_missing/inactive); previewed through the admin route, the store does not show it. */
    inStore: boolean;
  }[];
};
export type ProductImageResult = { ok: true } | {
  ok: false; reason: "not-found" | "merged" | "limit" | "duplicate" | "stale" | "image";
  /** Why the file was rejected (reason "image"). */
  image?: ProductImageErrorReason;
};
type Database = Pick<Pool, "connect" | "query">;

export const productImageChangeLabels: Record<string, string> = {
  image_added: "Görsel eklendi", image_removed: "Görsel silindi", image_primary: "Ana görsel", auto_image_hidden: "Otomatik görsel",
};

/** History text of an image change; null for other fields (the caller formats those). */
export function imageHistoryValue(field: string, value: string | null): string | null {
  if (field === "auto_image_hidden") return value === "true" ? "Mağazada gizli" : "Mağazada gösteriliyor";
  if (field in productImageChangeLabels) return value || "—";
  return null;
}

const media = (id: string) => `/api/product-media/${id}`;
const preview = (id: string) => `/api/admin/product-media/${id}`;

/** The enrichment images the product's store rows serve; `mediaId` narrows it to that one (authorization for a conversion). */
async function automaticImages(database: Pick<Pool, "query">, productId: string, mediaId?: string) {
  return (await database.query<{ image_id: string; width: number; height: number; supplier: string; in_store: boolean }>(
    // Storefront rows with a stored enrichment image; `in_store` marks the present ones /api/product-media serves (a present row wins per image).
    `SELECT DISTINCT ON (e.image_id) e.image_id::text,COALESCE((e.payload->>'imageWidth')::int,480) AS width,
      COALESCE((e.payload->>'imageHeight')::int,480) AS height,i.supplier,
      (i.presence='present') AS in_store
     FROM product_sources s JOIN storefront_enrichments e ON e.supplier_item_id=s.supplier_item_id
     JOIN supplier_items i ON i.id=s.supplier_item_id
     WHERE s.product_id=$1 AND e.image_id IS NOT NULL AND i.company=ANY($2::text[])
       AND ($3::uuid IS NULL OR e.image_id=$3::uuid)
     ORDER BY e.image_id,(i.presence='present') DESC,storefront_supplier_rank(i.supplier),i.code`, [productId, storefrontCompanies(), mediaId ?? null])).rows;
}

export async function loadProductImages(database: Pick<Pool, "query">, productId: string): Promise<ProductImages> {
  const [images, settings, automatic] = await Promise.all([
    database.query<{ id: string; media_id: string; width: number; height: number; file_name: string; carried: boolean }>(
      `SELECT i.id::text,i.media_id::text,i.width,i.height,i.file_name,i.carried_from IS NOT NULL AS carried
       FROM product_override_images i WHERE i.product_id=$1 ORDER BY i.position,i.id`, [productId]),
    database.query<{ hide_automatic: boolean }>("SELECT hide_automatic FROM product_override_image_settings WHERE product_id=$1", [productId]),
    automaticImages(database, productId),
  ]);
  const uploaded = new Set(images.rows.map(row => row.media_id));
  return {
    images: images.rows.map(row => ({ id: row.id, src: media(row.media_id), width: row.width, height: row.height, file_name: row.file_name, carried: row.carried })),
    hideAutomatic: Boolean(settings.rows[0]?.hide_automatic),
    automatic: automatic.map(row => ({ src: row.in_store ? media(row.image_id) : preview(row.image_id), mediaId: row.image_id, width: row.width, height: row.height,
      supplier: row.supplier, inGallery: uploaded.has(row.image_id), inStore: row.in_store }))
      .sort((a, b) => Number(b.inStore) - Number(a.inStore)),
  };
}

/**
 * Runs a gallery change in one transaction on the locked product (a merge carrying images locks the same row). A
 * change by the admin makes everything a merge carried here theirs: undoing that merge no longer takes it back.
 */
async function change(database: Pick<Pool, "connect">, productId: string,
  run: (client: PoolClient) => Promise<ProductImageResult | "unchanged">): Promise<ProductImageResult> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const product = (await client.query<{ merged_into: string | null }>("SELECT merged_into FROM products WHERE id=$1 FOR UPDATE", [productId])).rows[0];
    if (!product) { await client.query("ROLLBACK"); return { ok: false, reason: "not-found" }; }
    if (product.merged_into) { await client.query("ROLLBACK"); return { ok: false, reason: "merged" }; }
    const result = await run(client);
    if (result === "unchanged") { await client.query("ROLLBACK"); return { ok: true }; }
    if (!result.ok) { await client.query("ROLLBACK"); return result; }
    await client.query("UPDATE product_override_images SET carried_from=NULL WHERE product_id=$1 AND carried_from IS NOT NULL", [productId]);
    await client.query("UPDATE product_override_image_settings SET hide_carried_from=NULL WHERE product_id=$1 AND hide_carried_from IS NOT NULL", [productId]);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

const record = (client: PoolClient, productId: string, field: string, oldValue: string | null, newValue: string | null, adminId: string) =>
  client.query(`INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by) VALUES($1,$2,$3,$4,$5)`,
    [productId, field, oldValue, newValue, adminId]);

/** The display name kept with an upload: the file's base name, at most 200 characters. */
function fileName(name: string) {
  return name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
}

/**
 * Converts and stores one uploaded file and appends it to the product's gallery. The object is written before the
 * transaction (an object store call must not hold the product lock); a refused upload leaves an unreferenced object
 * for `npm run media:gc` to remove.
 */
export async function addProductImage(database: Database, productId: string, file: { bytes: Buffer; name: string }, adminId: string,
  storage?: Pick<S3Client, "send">): Promise<ProductImageResult> {
  const before = (await database.query<{ merged_into: string | null; images: number }>(`SELECT p.merged_into,
    (SELECT count(*)::int FROM product_override_images i WHERE i.product_id=p.id) AS images FROM products p WHERE p.id=$1`, [productId])).rows[0];
  if (!before) return { ok: false, reason: "not-found" };
  if (before.merged_into) return { ok: false, reason: "merged" };
  if (before.images >= productImageLimits.maxImages) return { ok: false, reason: "limit" };
  let prepared: Awaited<ReturnType<typeof prepareProductImage>>;
  try { prepared = await prepareProductImage(file.bytes); } catch (error) {
    if (error instanceof ProductImageError) return { ok: false, reason: "image", image: error.reason };
    throw error;
  }
  const mediaId = await storeProductImageBytes(database, prepared.bytes, `${siteUrl}/yonetim/urunler/${productId}`, storage, "admin");
  const name = fileName(file.name);
  return change(database, productId, async client => {
    const stats = (await client.query<{ images: number; next: number }>(`SELECT count(*)::int AS images,COALESCE(max(position)+1,0)::int AS next
      FROM product_override_images WHERE product_id=$1`, [productId])).rows[0];
    if (stats.images >= productImageLimits.maxImages) return { ok: false, reason: "limit" };
    const inserted = await client.query(`INSERT INTO product_override_images(product_id,media_id,position,width,height,file_name,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (product_id,media_id) DO NOTHING RETURNING id`,
    [productId, mediaId, stats.next, prepared.width, prepared.height, name, adminId]);
    if (!inserted.rowCount) return { ok: false, reason: "duplicate" };
    await record(client, productId, "image_added", null, name, adminId);
    return { ok: true };
  });
}

/**
 * "Yüklemeye çevir": adds the product's automatic image to the uploads at the end, reusing its media object (no copy,
 * no second hash), so the admin can order it or make it primary. It keeps its image when the enrichment later changes.
 * `supplierNames` maps supplier codes to the names the admin sees (file name "Zenginleştirme görseli (<name>)").
 */
export async function convertAutomaticImage(database: Pick<Pool, "connect">, productId: string, mediaId: string, adminId: string,
  supplierNames: Record<string, string> = {}) {
  return change(database, productId, async client => {
    // Under the product lock, and the authorization boundary: only this product's own automatic images convert, and only
    // those in the store: a converted upload is served publicly, which would publish a non-present row's image.
    const [automatic] = await automaticImages(client, productId, mediaId);
    if (!automatic?.in_store) return { ok: false, reason: "stale" };
    const stats = (await client.query<{ images: number; next: number }>(`SELECT count(*)::int AS images,COALESCE(max(position)+1,0)::int AS next
      FROM product_override_images WHERE product_id=$1`, [productId])).rows[0];
    if (stats.images >= productImageLimits.maxImages) return { ok: false, reason: "limit" };
    const name = `Zenginleştirme görseli (${supplierNames[automatic.supplier] ?? automatic.supplier})`;
    const inserted = await client.query(`INSERT INTO product_override_images(product_id,media_id,position,width,height,file_name,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (product_id,media_id) DO NOTHING RETURNING id`,
    [productId, mediaId, stats.next, automatic.width, automatic.height, name, adminId]);
    if (!inserted.rowCount) return { ok: false, reason: "duplicate" };
    await record(client, productId, "image_added", null, name, adminId);
    return { ok: true };
  });
}

type Row = { id: string; file_name: string };
const currentImages = async (client: PoolClient, productId: string) => (await client.query<Row>(
  "SELECT id::text,file_name FROM product_override_images WHERE product_id=$1 ORDER BY position,id", [productId])).rows;

/** Removes an upload from the gallery; the media object and its bytes stay until `npm run media:gc` collects them. */
export async function removeProductImage(database: Pick<Pool, "connect">, productId: string, imageId: string, adminId: string) {
  return change(database, productId, async client => {
    const images = await currentImages(client, productId);
    const index = images.findIndex(image => image.id === imageId);
    if (index < 0) return { ok: false, reason: "stale" };
    await client.query("DELETE FROM product_override_images WHERE id=$1", [imageId]);
    await record(client, productId, "image_removed", images[index].file_name, null, adminId);
    if (index === 0 && images[1]) await record(client, productId, "image_primary", images[0].file_name, images[1].file_name, adminId);
    return { ok: true };
  });
}

/** Stores the gallery in the given order; refused ("stale") unless it names exactly the product's current uploads. */
export async function reorderProductImages(database: Pick<Pool, "connect">, productId: string, orderedIds: string[], adminId: string) {
  return change(database, productId, async client => {
    const images = await currentImages(client, productId);
    const known = new Set(images.map(image => image.id));
    if (orderedIds.length !== images.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !known.has(id)))
      return { ok: false, reason: "stale" };
    if (orderedIds.every((id, index) => images[index].id === id)) return "unchanged";
    await client.query(`UPDATE product_override_images i SET position=o.n-1 FROM unnest($2::uuid[]) WITH ORDINALITY o(id,n)
      WHERE i.id=o.id AND i.product_id=$1`, [productId, orderedIds]);
    if (orderedIds[0] !== images[0].id)
      await record(client, productId, "image_primary", images[0].file_name, images.find(image => image.id === orderedIds[0])!.file_name, adminId);
    return { ok: true };
  });
}

/** "Otomatik görseli mağazada gizle": the enrichment image is left out of the store (uploads still show). */
export async function setAutomaticImageHidden(database: Pick<Pool, "connect">, productId: string, hidden: boolean, adminId: string) {
  return change(database, productId, async client => {
    const current = Boolean((await client.query<{ hide_automatic: boolean }>(
      "SELECT hide_automatic FROM product_override_image_settings WHERE product_id=$1", [productId])).rows[0]?.hide_automatic);
    if (current === hidden) return "unchanged";
    if (hidden) await client.query(`INSERT INTO product_override_image_settings(product_id,hide_automatic,updated_by) VALUES($1,true,$2)
      ON CONFLICT (product_id) DO UPDATE SET hide_automatic=true,hide_carried_from=NULL,updated_by=excluded.updated_by,updated_at=now()`, [productId, adminId]);
    else await client.query("DELETE FROM product_override_image_settings WHERE product_id=$1", [productId]);
    await record(client, productId, "auto_image_hidden", current ? "true" : null, hidden ? "true" : null, adminId);
    return { ok: true };
  });
}
