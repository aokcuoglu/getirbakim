import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { boundedQuery, db } from "@/lib/db";
import { objectStorage } from "@/lib/object-storage";
import { siteUrl } from "@/lib/site";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { catalogSql, withBestOffers, type CatalogProduct } from "@/modules/store/catalog";
import { getCatalogProductImages } from "@/modules/store/product-enrichment";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { feedDisabledReason, feedFiles, feedItem, feedManifestKey, feedOfferSkipReason, feedPublishDecision, feedSkipReason, parseManifest,
  renderFeedFooter, renderFeedHeader, renderFeedItem, type FeedCheckoutMode, type FeedSkipCounters, type FeedSource, type MerchantFeedManifest } from "./merchant-feed";
import { productChunkRange, productChunks } from "./sitemap";
import { indexableProductsSql, productAddressColumns } from "./sitemap.server";

const pricingBatch = 500;

/** Trodo category names (Turkish), read once per run; product_type is built from a category's path ids. */
export async function loadCategoryNames(): Promise<Map<number, string>> {
  const { rows } = await boundedQuery<{ id: number; name: string }>("merchant-feed.categoryNames", 
    "SELECT category_id AS id,name FROM source_category_labels WHERE source='trodo' AND locale='tr'", []);
  return new Map(rows.map(row => [row.id, row.name]));
}

// The barcode of a supplier row: the admin's first valid barcode (GTIN-8/12/13/14 with its check digit, the lengths the
// product page's gtinProperty knows), else the one valid GTIN among Dinamik's barkod1..3. Several different valid
// barcodes give none: a wrong GTIN gets an item rejected, a missing one only weakens it. A wrong Dinamik barcode is
// overridden by adding the right barcode as the admin's (an admin barcode can only be added, never hidden).
const gtinSql = `SELECT i.id::text AS id,
 (SELECT r.number_key FROM product_sources ps JOIN product_override_references r ON r.product_id=ps.product_id
   WHERE ps.supplier_item_id=i.id AND r.kind='ean' AND r.action='add' AND gtin_valid(r.number_key) ORDER BY r.created_at,r.id LIMIT 1) AS admin_ean,
 CASE WHEN i.supplier='dinamik' THEN ARRAY(SELECT DISTINCT b.code FROM unnest(ARRAY[i.product_data->>'barkod1',i.product_data->>'barkod2',i.product_data->>'barkod3']) v
   CROSS JOIN LATERAL (SELECT regexp_replace(upper(v),'[^A-Z0-9]','','g') AS code) b
   WHERE gtin_valid(b.code)) ELSE '{}' END AS barcodes
 FROM supplier_items i WHERE i.id=ANY($1::uuid[])`;

// The category of a supplier row as the listing files it (categoryProductIds in catalog.ts): a trusted enrichment's
// Trodo categories, replaced by the admin's category when one is set (#575). The deepest path wins. Bounded by the
// 500-id batch through product_enrichment_shared_links_pkey, ~2.5 ms (#1245).
const categorySql = `SELECT x.id::text AS id,c.path_ids AS path,x.admin FROM (
 SELECT e.supplier_item_id AS id,pc.category_id,false AS admin FROM storefront_enrichments e
  JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
  JOIN product_source_categories pc ON pc.supplier_item_id=e.donor_item_id AND pc.source='trodo'
  WHERE e.supplier_item_id=ANY($1::uuid[])
 UNION ALL SELECT ps.supplier_item_id,o.category_id,true FROM product_sources ps JOIN product_overrides o ON o.product_id=ps.product_id
  WHERE o.category_id IS NOT NULL AND NOT o.hidden AND ps.supplier_item_id=ANY($1::uuid[])) x
 JOIN source_categories c ON c.source='trodo' AND c.category_id=x.category_id`;

export type FeedChunk = { checked: number; sources: FeedSource[]; missing: number };

/**
 * The feed rows of sitemap chunk `index`: the indexable product pages (the sitemap's criterion, #641), priced and stocked
 * as the store shows them (commerce_catalog with the best grouped offer), with image, barcode and category for the rows
 * that can enter. `missing` counts indexable ids the saleable catalog does not hold.
 */
export async function loadFeedChunk(index: number, categoryNames: Map<number, string>): Promise<FeedChunk> {
  const { from, to } = productChunkRange(index);
  // Without `priceOnly`: the Dinamik price-list-only cards (#1068) are indexed pages but never orderable, so they are not
  // read here at all (and do not count as `missing`).
  const sql = indexableProductsSql({ supplier: productAddressColumns.supplier, store: productAddressColumns.store });
  const ids = (await boundedQuery<{ id: string }>(`merchant-feed.ids chunk=${index}`, `SELECT id FROM (${sql}) u ORDER BY id`, [storefrontCompanies(), from, to])).rows.map(row => row.id);
  const sources: FeedSource[] = [];
  let missing = 0;
  for (let start = 0; start < ids.length; start += pricingBatch) {
    const batch = ids.slice(start, start + pricingBatch);
    const rows = await withBestOffers((await boundedQuery<CatalogProduct>(`merchant-feed.catalog chunk=${index} offset=${start}`, `SELECT * FROM (${catalogSql}) catalog WHERE id=ANY($2::uuid[]) ORDER BY id`,
      [storefrontCompanies(), batch])).rows);
    missing += batch.length - rows.length;
    // Image, barcode and category only for the supplier rows price and stock let in (store rows carry no enrichment).
    const candidates = rows.filter(row => row.source === "supplier" && feedOfferSkipReason(row) === null);
    const candidateIds = candidates.map(row => row.id);
    const [images, gtins, categories] = await Promise.all([
      getCatalogProductImages(candidates),
      candidateIds.length ? boundedQuery<{ id: string; admin_ean: string | null; barcodes: string[] }>(`merchant-feed.gtins chunk=${index} offset=${start}`, gtinSql, [candidateIds]).then(result => result.rows) : [],
      candidateIds.length ? boundedQuery<{ id: string; path: number[]; admin: boolean }>(`merchant-feed.categories chunk=${index} offset=${start}`, categorySql, [candidateIds]).then(result => result.rows) : [],
    ]);
    const gtinById = new Map(gtins.map(row => [row.id, row.admin_ean ?? (row.barcodes.length === 1 ? row.barcodes[0] : null)]));
    const pathById = new Map<string, { path: number[]; admin: boolean }>();
    for (const row of categories) {
      const known = pathById.get(row.id);
      if (!known || (row.admin && !known.admin) || (row.admin === known.admin && row.path.length > known.path.length)) pathById.set(row.id, row);
    }
    for (const row of rows) {
      const path = pathById.get(row.id)?.path ?? [];
      sources.push({ ...row, image: images.get(row.id) ?? null, gtin: gtinById.get(row.id) ?? null,
        productType: path.map(id => categoryNames.get(id)).filter((name): name is string => Boolean(name)) });
    }
  }
  return { checked: ids.length, sources, missing };
}

/** Where the feed and its manifest are kept; S3_BUCKET by default, a stand-in in tests. */
export type FeedStore = {
  read(key: string): Promise<string | null>;
  write(key: string, body: { path: string; bytes: number } | { text: string }, contentType: string): Promise<void>;
};

export function s3FeedStore(bucket: string): FeedStore {
  const storage = objectStorage();
  return {
    async read(key) {
      try {
        const result = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return result.Body ? await result.Body.transformToString() : null;
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async write(key, body, contentType) {
      const content: Readable | string = "text" in body ? body.text : createReadStream(body.path);
      await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: contentType,
        ...("text" in body ? {} : { ContentLength: body.bytes }), CacheControl: "public, max-age=3600" }));
    },
  };
}

export type MerchantFeedRunOptions = {
  /** Builds the file and counts, but neither reads nor writes the store. */
  dryRun?: boolean;
  /** Publishes even when the drop guard objects. */
  force?: boolean;
  env?: Record<string, string | undefined>;
  store?: FeedStore;
  /** Chunks to build (default all); tests take fewer. */
  chunks?: number[];
  now?: Date;
};

export type MerchantFeedRunResult = {
  status: "completed" | "failed" | "skipped" | "disabled";
  dryRun: boolean;
  reason?: string;
  note?: string;
  checkoutMode?: FeedCheckoutMode;
  chunks: number;
  checked: number;
  items: number;
  skipped: FeedSkipCounters;
  /** Indexable ids the saleable catalog does not hold (counted in skipped.noPrice as well). */
  missing: number;
  previousItems?: number;
  bytes: number;
  error?: string;
  ms: number;
};

const lockKey = [20261117, 1];

/**
 * One run: every chunk's items streamed through gzip into a temporary file (memory stays per chunk), then the file and
 * its manifest uploaded in place of the previous ones, unless the drop guard objects (feedPublishDecision).
 */
export async function runMerchantFeed(options: MerchantFeedRunOptions = {}): Promise<MerchantFeedRunResult> {
  const started = Date.now();
  const { dryRun = false, force = false, env = process.env, now = new Date() } = options;
  const result: MerchantFeedRunResult = { status: "completed", dryRun, chunks: 0, checked: 0, items: 0,
    skipped: { demo: 0, noPrice: 0, notAvailable: 0, noImage: 0 }, missing: 0, bytes: 0, ms: 0 };
  const finish = () => ({ ...result, ms: Date.now() - started });
  const disabled = dryRun ? null : feedDisabledReason(env);
  if (disabled) return { ...finish(), status: "disabled", reason: disabled };
  const base = (env.SITE_URL?.trim() || siteUrl).replace(/\/$/, "");

  const lock = await db.connect();
  let lockBroken = false;
  try {
    if (!(await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1,$2) AS ok", lockKey)).rows[0].ok) {
      return { ...finish(), status: "skipped", reason: "another feed run holds the lock" };
    }
    const dir = await mkdtemp(join(tmpdir(), "merchant-feed-"));
    try {
      result.checkoutMode = await supplierCheckoutMode();
      const file = join(dir, "google.xml.gz");
      const gzip = createGzip();
      const written = pipeline(gzip, createWriteStream(file));
      // A write error mid-loop rejects `written` before it is awaited; the handler keeps it from becoming an unhandled
      // rejection (which would end the process past the finally below). The error itself is still awaited.
      written.catch(() => {});
      const write = async (text: string) => { if (!gzip.write(text)) await once(gzip, "drain"); };
      try {
        await write(renderFeedHeader(base));
        const categoryNames = await loadCategoryNames();
        for (const chunk of options.chunks ?? Array.from({ length: productChunks }, (_, index) => index)) {
          const loaded = await loadFeedChunk(chunk, categoryNames);
          result.chunks++;
          result.checked += loaded.checked;
          result.missing += loaded.missing;
          result.skipped.noPrice += loaded.missing;
          for (const source of loaded.sources) {
            const reason = feedSkipReason(source);
            if (reason) { result.skipped[reason]++; continue; }
            const item = feedItem(source, base, now);
            if (!item) continue;
            await write(renderFeedItem(item));
            result.items++;
          }
        }
        await write(renderFeedFooter());
        gzip.end();
        await written;
      } catch (error) {
        gzip.destroy(error instanceof Error ? error : new Error(String(error)));
        await written.catch(() => {});
        throw error;
      }
      result.bytes = (await stat(file)).size;
      if (dryRun) return finish();

      const store = options.store ?? s3FeedStore(env.S3_BUCKET!.trim());
      const previous = parseManifest(await store.read(feedManifestKey));
      result.previousItems = previous?.items ?? 0;
      const decision = feedPublishDecision({ previousItems: result.previousItems, items: result.items, checkoutMode: result.checkoutMode, force });
      if (!decision.publish) return { ...finish(), status: "failed", reason: decision.reason };
      if (decision.note) result.note = decision.note;
      await store.write(feedFiles["google.xml.gz"].key, { path: file, bytes: result.bytes }, "application/gzip");
      const manifest: MerchantFeedManifest = { generatedAt: now.toISOString(), items: result.items, checked: result.checked, skipped: result.skipped,
        checkoutMode: result.checkoutMode, bytes: result.bytes, ms: Date.now() - started, ...result.note ? { note: result.note } : {} };
      await store.write(feedManifestKey, { text: `${JSON.stringify(manifest)}\n` }, "application/json");
      return finish();
    } catch (error) {
      return { ...finish(), status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      await rm(dir, { recursive: true, force: true });
      await lock.query("SELECT pg_advisory_unlock($1,$2)", lockKey).catch(() => { lockBroken = true; });
    }
  } finally { lock.release(lockBroken); }
}
