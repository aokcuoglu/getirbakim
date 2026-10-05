import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { manufacturerBrandKey, matchesSupplierPart } from "./enrichment-contract";

export function verifiedLogoBrand(supplier: {brand: string; code: string}, source: {manufacturer: string; partNumber: string}) {
  if (!matchesSupplierPart(supplier.brand, supplier.code, source.manufacturer, source.partNumber)) {
    throw new Error("A reference product's logo cannot represent another supplier brand");
  }
  const key = manufacturerBrandKey(supplier.brand);
  if (!/^[A-Z0-9]{1,100}$/.test(key)) throw new Error("Invalid manufacturer brand key");
  return key;
}

export function readLogoPng(bytes: Buffer) {
  if (bytes.length < 45 || bytes.length > 1048576 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12,16).toString() !== "IHDR"
    || !bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]))) throw new Error("Invalid PNG logo");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 2048 || height > 2048) throw new Error("Invalid logo dimensions");
  return {width,height,sha256:createHash("sha256").update(bytes).digest("hex")};
}

export async function importManufacturerLogo(client: PoolClient, productId: string, logo: {imageFile: string; imageSource: string}) {
  const url = new URL(logo.imageSource);
  if (url.protocol !== "https:" || url.hostname !== "www.trodo.com" || url.username || url.password
    || !/^\/media\/manufacturer_(cache|source)\/\d+\//.test(url.pathname)) throw new Error("Unexpected manufacturer logo source");
  const row = (await client.query(`SELECT s.code,s.product_data->>'uk' AS brand,e.supplier_code,e.supplier_brand,
    e.manufacturer,e.manufacturer_part_number,e.source_url FROM supplier_items s
    JOIN product_enrichments e ON e.supplier_item_id=s.id WHERE s.id=$1 FOR SHARE OF s,e`,[productId])).rows[0];
  if (!row || row.code !== row.supplier_code || row.brand !== row.supplier_brand) throw new Error("Logo evidence does not match current supplier product");
  const key = verifiedLogoBrand(row,{manufacturer:row.manufacturer,partNumber:row.manufacturer_part_number});
  const bytes = await readFile(logo.imageFile);
  const {width,height,sha256} = readLogoPng(bytes);
  await client.query(`INSERT INTO manufacturer_logos(brand_key,manufacturer,image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(brand_key) DO UPDATE SET
    manufacturer=EXCLUDED.manufacturer,image_data=EXCLUDED.image_data,sha256=EXCLUDED.sha256,
    width=EXCLUDED.width,height=EXCLUDED.height,source_url=EXCLUDED.source_url,
    evidence_product_id=EXCLUDED.evidence_product_id,evidence_source_url=EXCLUDED.evidence_source_url,imported_at=now()
    WHERE manufacturer_logos.sha256 IS DISTINCT FROM EXCLUDED.sha256`,
    [key,row.manufacturer,bytes,sha256,width,height,url.href,productId,row.source_url]);
  return {brandKey:key,width,height};
}
