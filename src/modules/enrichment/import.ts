import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { objectStorage } from "../../lib/object-storage";
import { enrichmentImportSchema, matchesEnrichment } from "../store/enrichment-contract";
import { lockFitmentSync, loadFitmentMatcher, syncProductFitments } from "../store/fitment-sync";
import { importManufacturerLogo } from "../store/manufacturer-logo-import";

export async function importEnrichments(pool: Pool, entries: unknown[], matcher: (client: PoolClient)=>ReturnType<typeof loadFitmentMatcher> = loadFitmentMatcher) {
 const items = entries.map(entry => enrichmentImportSchema.parse(entry));
    for (const item of items) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await lockFitmentSync(client);
        const supplier = (await client.query(`SELECT code,product_data->>'uk' AS brand,COALESCE(product_data->>'oe','') AS oem FROM supplier_items WHERE id=$1 FOR SHARE`, [item.supplierItemId])).rows[0];
        if (!supplier || supplier.code !== item.supplierCode || supplier.brand !== item.supplierBrand
          || !matchesEnrichment(supplier, item)) {
          throw new Error(`Manufacturer/part mismatch for ${item.supplierItemId}; nothing imported`);
        }
        const previous = (await client.query("SELECT status FROM product_enrichment_jobs WHERE supplier_item_id=$1 FOR UPDATE", [item.supplierItemId])).rows[0];
        if (previous?.status === "complete" && item.completeness === "partial") throw new Error("Partial data cannot replace a complete enrichment");
        let imageId: string | null = null;
        if (item.imageFile) {
          if (!item.imageSource) throw new Error("Image source URL is required");
          const bytes = await readFile(resolve(item.imageFile));
          if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Invalid image size");
          const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
          const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
          const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
          const extension = webp ? "webp" : jpeg ? "jpg" : png ? "png" : null;
          if (!extension) throw new Error("Only verified WebP, JPEG and PNG images can be imported");
          const contentType = webp ? "image/webp" : jpeg ? "image/jpeg" : "image/png";
          const hash = createHash("sha256").update(bytes).digest("hex");
          const bucket = process.env.S3_BUCKET;
          if (!bucket) throw new Error("S3_BUCKET is required");
          const key = `products/${hash.slice(0, 2)}/${hash}.${extension}`;
          const storage = objectStorage();
          const existing = (await client.query("SELECT id FROM product_media_objects WHERE sha256=$1",[hash])).rows[0];
          if (!existing) await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, Metadata: { sha256: hash } }));
          const head = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          if (head.ContentLength !== bytes.length || head.Metadata?.sha256 !== hash) throw new Error("Object verification failed");
          imageId = (await client.query(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id`,
            [bucket, key, hash, contentType, bytes.length, item.imageSource])).rows[0].id;
        }
        await client.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload,match_basis)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(supplier_item_id) DO UPDATE SET
          supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,source_url=EXCLUDED.source_url,source_method=EXCLUDED.source_method,
          manufacturer=EXCLUDED.manufacturer,manufacturer_part_number=EXCLUDED.manufacturer_part_number,image_id=COALESCE(EXCLUDED.image_id,product_enrichments.image_id),payload=EXCLUDED.payload,match_basis=EXCLUDED.match_basis,imported_at=now()`,
          [item.supplierItemId, item.supplierCode, item.supplierBrand, item.source, item.sourceMethod, item.manufacturer, item.partNumber, imageId, JSON.stringify(item.data), JSON.stringify(item.matchBasis)]);
        await client.query('DELETE FROM product_source_categories WHERE supplier_item_id=$1',[item.supplierItemId]);
        for(const category of item.data.categories)await client.query(`INSERT INTO product_source_categories(supplier_item_id,source,category_id)
          SELECT $1,source,category_id FROM source_categories WHERE source=$2 AND category_id=$3 ON CONFLICT DO NOTHING`,[item.supplierItemId,category.source,category.id]);
        await client.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status,last_attempt_at,attempts,candidate_url)
          VALUES($1,$2,$3,$4,now(),1,$5) ON CONFLICT(supplier_item_id) DO UPDATE SET status=EXCLUDED.status,
          candidate_url=EXCLUDED.candidate_url,attempts=product_enrichment_jobs.attempts+1,last_attempt_at=now(),last_error=NULL,updated_at=now()`,
          [item.supplierItemId, item.supplierCode, item.supplierBrand, item.completeness, item.source]);
        if (item.brandLogo) await importManufacturerLogo(client, item.supplierItemId, item.brandLogo);
        const fitments = await syncProductFitments(client, item.supplierItemId, item.data, await matcher(client));
        await client.query("COMMIT");
        console.log(JSON.stringify({ imported: item.supplierItemId, status: item.completeness, image: Boolean(imageId), fitments }));
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
}
