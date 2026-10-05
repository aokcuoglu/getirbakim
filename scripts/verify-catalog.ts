import assert from "node:assert/strict";
import { browseProducts, getProduct } from "../src/modules/store/catalog";
import { db } from "../src/lib/db";
import { getCatalogProductImages, getProductEnrichment } from "../src/modules/store/product-enrichment";

// Read-only integration verification against the imported local supplier data.
try {
 const first = await browseProducts({});
 const supplier = first.items.find(item => item.source === "supplier");
 assert.ok(supplier, "Expected imported Başbuğ products in the general catalog");
 assert.equal(supplier.category, null);
 assert.ok(supplier.price_kurus === null || supplier.price_kurus > 0);
 assert.equal(supplier.stock, null);
 assert.equal((await getProduct(supplier.id))?.code, supplier.code);
 const second = await browseProducts({page:"2"});
 assert.equal(second.page, 2);
 assert.ok(second.items.every(item => !first.items.some(other => other.id === item.id)));
 const search = await browseProducts({q:supplier.code,searchBy:"code"});
 assert.ok(search.items.some(item => item.id === supplier.id));
 if (supplier.oem) {
  const oem = await browseProducts({q:supplier.oem,searchBy:"code"});
  assert.ok(oem.total > 0, "OEM search should match supplier references");
 }
 const brand = await browseProducts({brand:supplier.brand});
 assert.ok(brand.items.every(item => item.brand === supplier.brand));
 assert.equal((await browseProducts({page:"-1"})).page, 1);
 assert.equal((await browseProducts({page:"invalid"})).page, 1);
 const spareParts = await browseProducts({category:"yedek-parca",q:supplier.code,searchBy:"code"});
 assert.ok(!spareParts.items.some(item => item.id === supplier.id), "Uncategorized supplier products must not appear under spare parts");
 const otherCategory = await browseProducts({category:"fren"});
 assert.ok(otherCategory.items.every(item => item.category === "fren"));
 const hidden = (await db.query<{id:string}>("SELECT id FROM supplier_items WHERE supplier='basbug' AND (conflicting OR presence<>'present') LIMIT 5")).rows;
 for (const item of hidden) assert.equal(await getProduct(item.id), undefined);
 const base = process.env.VERIFY_URL || "http://localhost:3000";
 const response = await fetch(`${base}/katalog`);
 assert.equal(response.status, 200);
 const html = await response.text();
 assert.ok(html.includes("Sepete ekle") || html.includes("Fiyat bilgisi güncelleniyor"));
 assert.ok(html.includes("Sonraki sayfa"));
 const filtered = await fetch(`${base}/katalog?category=yedek-parca&q=${encodeURIComponent(supplier.code)}&searchBy=code`);
 assert.equal(filtered.status, 200);
 assert.ok(!(await filtered.text()).includes(`href="/urun/${supplier.id}"`));
 const detail = await fetch(`${base}/urun/${supplier.id}`);
 assert.equal(detail.status, 200);
 const detailHtml = await detail.text();
 assert.ok(detailHtml.includes("KDV dahil") || detailHtml.includes("Fiyat bilgisi güncelleniyor"));
 const enrichedRows = (await db.query<{id:string}>(`SELECT e.supplier_item_id AS id FROM product_enrichments e
  JOIN supplier_items s ON s.id=e.supplier_item_id WHERE e.image_id IS NOT NULL
  AND s.presence='present' AND s.company=$1`, [process.env.BASBUG_FIRMA_ADI || "BASBUG"])).rows;
 const enrichedProducts = (await Promise.all(enrichedRows.map(row => getProduct(row.id)))).filter(product => product !== undefined);
 const images = await getCatalogProductImages(enrichedProducts);
 assert.equal((await getCatalogProductImages([])).size, 0);
 for (const product of enrichedProducts) {
  const enrichment = await getProductEnrichment(product);
  assert.equal(images.get(product.id)?.src ?? null, enrichment?.imagePath ?? null, "Catalog images must follow detail-page matching rules");
 }
 const withImage = enrichedProducts.find(product => images.has(product.id));
 if (enrichedProducts.length) assert.ok(withImage, "Imported images should be visible in the catalog");
 if (withImage) {
  const image = images.get(withImage.id)!;
  const stale = await getCatalogProductImages([{...withImage,code:"STALE-CODE"},{...supplier,id:"00000000-0000-4000-8000-000000000000"}]);
  assert.equal(stale.size, 0, "Stale and missing enrichment must fall back to illustrations");
  assert.equal((await getCatalogProductImages([{...withImage,brand:"STALE-BRAND"}])).size, 0);
  const imagePage = await fetch(`${base}/katalog?q=${encodeURIComponent(withImage.code)}&searchBy=code`);
  assert.equal(imagePage.status, 200);
  const imageHtml = await imagePage.text();
  assert.ok(imageHtml.includes(`src="${image.src}"`), "Catalog HTML should render the imported image");
  const media = await fetch(`${base}${image.src}`);
  assert.equal(media.status, 200);
  assert.ok(media.headers.get("content-type")?.startsWith("image/"));
  assert.ok((await media.arrayBuffer()).byteLength > 0);
 }
 console.log(`Catalog verified: ${first.total} products, pagination, code/OEM search, brand/category filters, detail and visibility rules.`);
 console.log(`Enrichment images verified: ${images.size} matching products, stale-data fallback and HTTP image delivery.`);
} finally {
 await db.end();
}
