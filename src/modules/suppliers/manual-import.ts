import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { siteUrl } from "../../lib/site";
import { storeProductImageBytes } from "../enrichment/import";
import { legacyCategoryIds } from "../store/category-tree";
import { manualCompany } from "./storefront-sources";
import { applySupplierSnapshot, type ObservationItem } from "./sync";
import type { ManualCategory, ManualIssue, ManualParseResult, ManualRow } from "./manual-template";

// Manual xlsx lists (template: manual-template.ts). Each list is one supplier scope, imported like an API snapshot:
// codes missing from a new upload go pending_missing, then inactive. What the storefront shows beyond name, price and
// stock (description, specifications, category, image) is written as the item's own enrichment, which the product
// page, listing images and category filters already read, and which a matched Başbuğ/Dinamik row of the same product
// shares. Its job is "complete", so no enrichment source searches these items.
export const manualSupplier = "manual";
export const manualScope = (listGroup: string) => ({ supplier: manualSupplier, company: manualCompany, group: listGroup, warehouse: "MAIN" } as const);
export const manualSourceMethod = "manual-upload";
const lock = [20261001, 8];

export class ManualImportError extends Error {
  constructor(public readonly reason: "busy" | "not-found" | "invalid" | "decided", public readonly detail?: string) {
    super(`Manual list: ${reason}${detail ? ` (${detail})` : ""}`);
  }
}

/** The template's optional fields: the item page can fill those an upload leaves empty (name, brand, category always come from the file). */
export const manualEditableFields = ["price", "stock", "barcode", "description", "viscosity", "package", "approvals", "imageUrl"] as const;
export type ManualEditableField = (typeof manualEditableFields)[number];
export type ManualValues = Omit<ManualRow, "sheet" | "row">;
export type ManualOverrides = Partial<Pick<ManualValues, ManualEditableField>>;

const empty = (value: unknown) => value === null || value === undefined || value === "";
/** A filled cell of the upload wins; the admin's value fills only what the upload leaves empty. */
export function withOverrides(row: ManualValues, overrides: ManualOverrides | undefined): ManualValues {
  if (!overrides) return row;
  const merged = { ...row } as Record<string, unknown>;
  for (const field of manualEditableFields) if (empty(merged[field]) && !empty(overrides[field])) merged[field] = overrides[field];
  return merged as ManualValues;
}

export function listSlug(name: string) {
  return name.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
}

export async function manualCategories(pool: Pick<Pool, "query">): Promise<ManualCategory[]> {
  return (await pool.query<ManualCategory>(`SELECT c.category_id AS id,l.name,
    (SELECT json_agg(json_build_object('id',p.id,'name',pl.name) ORDER BY p.o) FROM unnest(c.path_ids) WITH ORDINALITY p(id,o)
     JOIN source_category_labels pl ON pl.source=c.source AND pl.category_id=p.id AND pl.locale='tr') AS path
    FROM source_categories c JOIN source_category_labels l ON l.source=c.source AND l.category_id=c.category_id AND l.locale='tr'
    WHERE c.source='trodo'`)).rows;
}

// The storefront still reads a legacy category key for its card art and fallback breadcrumb (category-tree.ts).
const legacyKey = (category: ManualCategory) =>
  Object.entries(legacyCategoryIds).find(([key, id]) => key !== "yedek-parca" && category.path.some(node => node.id === id))?.[0] ?? "yedek-parca";

/** Başbuğ field names (ac name, uk brand, dc currency…) are what storefront, search and matching read. */
export function manualProductData(row: ManualValues, file: ManualValues, category: ManualCategory, listName: string) {
  return {
    no: row.code, ac: row.name, ac2: "", uk: row.brand, oe: "", dc: "TRY", category: legacyKey(category),
    category_id: category.id, category_name: category.name, barcode: row.barcode, description: row.description,
    viscosity: row.viscosity, package: row.package, approvals: row.approvals, image_url: row.imageUrl, list_name: listName,
    // The upload's own values: an override applies only where these are empty, also after the item page edits it.
    file,
  };
}

export function manualSpecifications(row: ManualValues): [string, string][] {
  return ([["Viskozite", row.viscosity], ["Ambalaj", row.package], ["Onaylar ve normlar", row.approvals], ["Barkod", row.barcode]] as [string, string | null][])
    .filter((entry): entry is [string, string] => Boolean(entry[1]));
}

function manualEnrichment(row: ManualValues, category: ManualCategory, image?: { width: number; height: number }) {
  return {
    categories: [{ source: "trodo", id: category.id, name: category.name, path: category.path }],
    ...(row.description ? { description: row.description } : {}),
    specifications: manualSpecifications(row), oemNumbers: {}, crossReferences: {}, vehicles: [], vehicleModels: [],
    imageWidth: image?.width ?? 480, imageHeight: image?.height ?? 480,
  };
}

function observation(row: ManualValues, file: ManualValues, category: ManualCategory, listName: string): ObservationItem {
  return {
    code: row.code, product_data: manualProductData(row, file, category, listName),
    price_data: row.price ? { nf: row.price } : null, stock_data: row.stock === null ? null : { stok: row.stock },
    product_count: 1, price_count: row.price ? 1 : 0, stock_count: row.stock === null ? 0 : 1, conflicting: false, source_variants: {},
  };
}

function quality(rows: ManualValues[], issues: ManualIssue[]) {
  return {
    productRows: rows.length, uniqueProducts: rows.length, missingPrices: rows.filter(row => !row.price).length,
    missingStocks: rows.filter(row => row.stock === null).length, outOfStock: rows.filter(row => row.stock === 0).length,
    missingPackages: rows.filter(row => !row.package).length, images: rows.filter(row => row.imageUrl).length,
    warnings: issues.filter(issue => issue.level === "warning").length, duplicateCodes: 0, conflictingCodes: 0,
  };
}

// Admin-entered links are fetched by the server: only public addresses, a few redirects, images up to 10 MB.
const privateAddress = (address: string) => isIP(address) === 4
  ? /^(0|10|127)\./.test(address) || /^169\.254\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address) || /^192\.168\./.test(address) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
  : address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address) || /^::ffff:/i.test(address);

export async function downloadImage(link: string): Promise<{ bytes: Buffer; width: number; height: number }> {
  let url = new URL(link);
  for (let hop = 0; hop < 4; hop++) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsupported link");
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw new Error("private address");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { Accept: "image/*" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get("content-length") || 0) > 10 * 1024 * 1024) throw new Error("too large");
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > 10 * 1024 * 1024) throw new Error("too large");
    const image = sharp(raw, { limitInputPixels: 40_000_000 });
    const meta = await image.metadata().catch(() => { throw new Error("not an image"); });
    if (!meta.width || !meta.height) throw new Error("not an image");
    // Stored formats are WebP/JPEG/PNG (product_media_objects); anything else (AVIF, GIF…) is converted once.
    const bytes = ["webp", "jpeg", "png"].includes(meta.format ?? "") ? raw : await image.webp({ quality: 85 }).toBuffer();
    return { bytes, width: meta.width, height: meta.height };
  }
  throw new Error("too many redirects");
}

type StoredImage = { id: string; width: number; height: number };
/** Each link once; a link already stored (an earlier upload) is reused without downloading. */
async function storeImages(pool: Pool, links: string[], download: typeof downloadImage) {
  const stored = new Map<string, StoredImage>();
  const failed = new Map<string, string>();
  const known = (await pool.query<{ source_url: string; id: string; width: number | null; height: number | null }>(`SELECT DISTINCT ON (m.source_url) m.source_url,m.id,
      (e.payload->>'imageWidth')::int AS width,(e.payload->>'imageHeight')::int AS height
    FROM product_media_objects m LEFT JOIN product_enrichments e ON e.image_id=m.id WHERE m.source_url=ANY($1::text[])
    ORDER BY m.source_url,e.imported_at DESC NULLS LAST`, [links])).rows;
  for (const row of known) if (row.width && row.height) stored.set(row.source_url, { id: row.id, width: row.width, height: row.height });
  const queue = links.filter(link => !stored.has(link));
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let link = queue.shift(); link; link = queue.shift()) {
      try {
        const image = await download(link);
        stored.set(link, { id: await storeProductImageBytes(pool, image.bytes, link), width: image.width, height: image.height });
      } catch (error) { failed.set(link, error instanceof Error ? error.message.slice(0, 120) : "download failed"); }
    }
  }));
  return { stored, failed };
}

async function writeEnrichments(client: PoolClient, listGroup: string, rows: { code: string; row: ManualValues; category: ManualCategory; image?: StoredImage }[]) {
  const scope = manualScope(listGroup);
  const ids = new Map((await client.query<{ id: string; code: string }>(`SELECT id,code FROM supplier_items WHERE supplier=$1 AND company=$2
    AND list_group=$3 AND warehouse=$4 AND code=ANY($5::text[])`, [scope.supplier, scope.company, scope.group, scope.warehouse, rows.map(r => r.code)])).rows.map(r => [r.code, r.id]));
  const entries = rows.map(({ code, row, category, image }) => ({
    id: ids.get(code)!, code, brand: row.brand, category: category.id, image: image?.id ?? null,
    source: row.imageUrl && image ? row.imageUrl : `${siteUrl}/yonetim/tedarikciler/manuel?liste=${listGroup}`,
    payload: manualEnrichment(row, category, image),
  }));
  await client.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,code text,brand text,category int,image uuid,source text,payload jsonb))
    INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload,match_basis)
    SELECT id,code,brand,source,$2,brand,code,image,payload,'{"type":"exact_part"}' FROM x
    ON CONFLICT(supplier_item_id) DO UPDATE SET supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,
      source_url=EXCLUDED.source_url,source_method=EXCLUDED.source_method,manufacturer=EXCLUDED.manufacturer,
      manufacturer_part_number=EXCLUDED.manufacturer_part_number,image_id=EXCLUDED.image_id,payload=EXCLUDED.payload,
      match_basis=EXCLUDED.match_basis,imported_at=now()
    WHERE (product_enrichments.supplier_code,product_enrichments.supplier_brand,product_enrichments.source_url,product_enrichments.image_id,product_enrichments.payload)
      IS DISTINCT FROM (EXCLUDED.supplier_code,EXCLUDED.supplier_brand,EXCLUDED.source_url,EXCLUDED.image_id,EXCLUDED.payload)`,
  [JSON.stringify(entries), manualSourceMethod]);
  await client.query(`DELETE FROM product_source_categories c USING jsonb_to_recordset($1::jsonb) AS x(id uuid,category int)
    WHERE c.supplier_item_id=x.id AND (c.source,c.category_id)<>('trodo',x.category)`, [JSON.stringify(entries)]);
  await client.query(`INSERT INTO product_source_categories(supplier_item_id,source,category_id)
    SELECT x.id,'trodo',x.category FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,category int) ON CONFLICT DO NOTHING`, [JSON.stringify(entries)]);
  await client.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status,last_attempt_at,attempts,candidate_url)
    SELECT id,code,brand,'complete',now(),1,source FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,code text,brand text,source text)
    ON CONFLICT(supplier_item_id) DO UPDATE SET supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,status='complete',
      candidate_url=EXCLUDED.candidate_url,last_error=NULL,updated_at=now()
    WHERE (product_enrichment_jobs.supplier_code,product_enrichment_jobs.supplier_brand,product_enrichment_jobs.status,product_enrichment_jobs.candidate_url)
      IS DISTINCT FROM (EXCLUDED.supplier_code,EXCLUDED.supplier_brand,'complete',EXCLUDED.candidate_url)`, [JSON.stringify(entries)]);
}

export type ManualDraftReport = {
  sheets: ManualParseResult["sheets"]; issues: ManualIssue[]; errors: number; warnings: number;
  products: number; added: number; updated: number; removed: number; removedCodes: string[];
};

/** Stores a parsed upload for review. Nothing in the catalog changes until the draft is confirmed. */
export async function saveManualDraft(pool: Pool, input: { listGroup: string; listName: string; fileName: string; parsed: ManualParseResult; by: string | null }) {
  const scope = manualScope(input.listGroup);
  const codes = input.parsed.rows.map(row => row.code);
  const existing = (await pool.query<{ code: string }>(`SELECT code FROM supplier_items WHERE supplier=$1 AND company=$2 AND list_group=$3
    AND warehouse=$4 AND presence<>'inactive'`, [scope.supplier, scope.company, scope.group, scope.warehouse])).rows.map(row => row.code);
  const incoming = new Set(codes);
  const known = new Set(existing);
  const removed = existing.filter(code => !incoming.has(code)).sort();
  const report: ManualDraftReport = {
    sheets: input.parsed.sheets, issues: input.parsed.issues,
    errors: input.parsed.issues.filter(issue => issue.level === "error").length, warnings: input.parsed.issues.filter(issue => issue.level === "warning").length,
    products: codes.length, added: codes.filter(code => !known.has(code)).length, updated: codes.filter(code => known.has(code)).length,
    removed: removed.length, removedCodes: removed.slice(0, 200),
  };
  return (await pool.query<{ id: string }>(`INSERT INTO manual_uploads(list_group,list_name,file_name,rows,report,uploaded_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [input.listGroup, input.listName, input.fileName.slice(0, 200), JSON.stringify(input.parsed.rows), JSON.stringify(report), input.by])).rows[0].id;
}

/** Imports a reviewed draft. A draft with errors is refused; the admin fixes the file and uploads it again. */
export async function importManualDraft(pool: Pool, draftId: string, download: typeof downloadImage = downloadImage) {
  const draft = (await pool.query<{ list_group: string; list_name: string; file_name: string; rows: ManualRow[]; report: ManualDraftReport; status: string }>(
    "SELECT list_group,list_name,file_name,rows,report,status FROM manual_uploads WHERE id=$1", [draftId])).rows[0];
  if (!draft) throw new ManualImportError("not-found");
  if (draft.status !== "draft") throw new ManualImportError("decided");
  if (draft.report.errors || !draft.rows.length) throw new ManualImportError("invalid");
  const scope = manualScope(draft.list_group);
  const categories = new Map((await manualCategories(pool)).map(category => [category.id, category]));
  const overrides = new Map((await pool.query<{ code: string; fields: ManualOverrides }>("SELECT code,fields FROM manual_item_overrides WHERE list_group=$1", [draft.list_group])).rows.map(row => [row.code, row.fields]));
  const rows = draft.rows.map(source => {
    const file: ManualValues = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "sheet" && key !== "row")) as ManualValues;
    return { file, row: withOverrides(file, overrides.get(file.code)) };
  });
  for (const { row } of rows) if (!categories.has(row.categoryId)) throw new ManualImportError("invalid", `category ${row.categoryId}`);
  const connection = await pool.connect();
  let locked = false;
  let inTransaction = false;
  let runId: string | undefined;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock($1,$2) AS locked", lock)).rows[0].locked;
    if (!locked) throw new ManualImportError("busy");
    runId = (await connection.query<{ id: string }>(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,status,observations,quality,groups_data,currencies_data,run_kind)
      VALUES($1,$2,$3,$4,now(),'running',$5,'{}','{}','{}','full') RETURNING id`,
    [scope.supplier, scope.company, scope.group, scope.warehouse, JSON.stringify({ file: draft.file_name, upload: draftId })])).rows[0].id;
    // Downloads happen before the transaction: no row locks are held while waiting on other servers.
    const images = await storeImages(pool, [...new Set(rows.map(({ row }) => row.imageUrl).filter((url): url is string => Boolean(url)))], download);
    const imageIssues: ManualIssue[] = [...images.failed].map(([url, reason]) => ({ sheet: "", row: null, code: rows.find(({ row }) => row.imageUrl === url)?.row.code ?? null,
      field: "imageUrl", level: "warning", message: `Resim indirilemedi (${reason}): ${url}` }));
    await connection.query("BEGIN"); inTransaction = true;
    const observedAt = new Date();
    const stats = await applySupplierSnapshot(connection, scope, runId, rows.map(({ row, file }) => observation(row, file, categories.get(row.categoryId)!, draft.list_name)), observedAt, true);
    await writeEnrichments(connection, draft.list_group, rows.map(({ row }) => ({ code: row.code, row, category: categories.get(row.categoryId)!,
      image: row.imageUrl ? images.stored.get(row.imageUrl) : undefined })));
    const result = { ...quality(rows.map(({ row }) => row), [...draft.report.issues, ...imageIssues]), imagesStored: rows.filter(({ row }) => row.imageUrl && images.stored.has(row.imageUrl)).length,
      imagesFailed: images.failed.size };
    await connection.query(`UPDATE supplier_imports SET status='succeeded',completed_at=$2,quality=$3,stats=$4 WHERE id=$1`, [runId, observedAt, JSON.stringify(result), JSON.stringify(stats)]);
    await connection.query(`UPDATE manual_uploads SET status='imported',decided_at=now(),import_id=$2,
      report=jsonb_set(report,'{issues}',report->'issues' || $3::jsonb) WHERE id=$1`, [draftId, runId, JSON.stringify(imageIssues)]);
    await connection.query("COMMIT"); inTransaction = false;
    return { id: runId, listGroup: draft.list_group, ...result, stats };
  } catch (error) {
    if (inTransaction) await connection.query("ROLLBACK");
    if (runId) await connection.query(`UPDATE supplier_imports SET status='failed',completed_at=clock_timestamp(),error_reason=$2 WHERE id=$1`,
      [runId, error instanceof ManualImportError ? error.reason : "db"]);
    throw error;
  } finally {
    try { if (locked) await connection.query("SELECT pg_advisory_unlock($1,$2)", lock); }
    finally { connection.release(); }
  }
}

/** Saves the item page's values and applies them to the current item at once (and to later uploads, see withOverrides). */
export async function updateManualItem(pool: Pool, itemId: string, values: ManualOverrides, by: string | null, download: typeof downloadImage = downloadImage) {
  const item = (await pool.query<{ list_group: string; code: string; product_data: ReturnType<typeof manualProductData> }>(
    "SELECT list_group,code,product_data FROM supplier_items WHERE id=$1 AND supplier=$2 AND company=$3", [itemId, manualSupplier, manualCompany])).rows[0];
  if (!item) throw new ManualImportError("not-found");
  const categories = new Map((await manualCategories(pool)).map(category => [category.id, category]));
  const file = item.product_data.file;
  // Only fields the upload leaves empty are kept (a filled cell wins anyway); an emptied field drops the override.
  const fields = Object.fromEntries(manualEditableFields.filter(field => empty(file[field]) && !empty(values[field])).map(field => [field, values[field]]));
  const row = withOverrides(file, fields);
  const image = row.imageUrl ? (await storeImages(pool, [row.imageUrl], download)) : null;
  if (row.imageUrl && image?.failed.size) throw new ManualImportError("invalid", `image: ${image.failed.get(row.imageUrl)}`);
  const connection = await pool.connect();
  let locked = false;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock($1,$2) AS locked", lock)).rows[0].locked;
    if (!locked) throw new ManualImportError("busy");
    await connection.query("BEGIN");
    await connection.query(`INSERT INTO manual_item_overrides(list_group,code,fields,updated_by) VALUES($1,$2,$3,$4)
      ON CONFLICT(list_group,code) DO UPDATE SET fields=EXCLUDED.fields,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [item.list_group, item.code, JSON.stringify(fields), by]);
    const next = observation(row, file, categories.get(row.categoryId)!, item.product_data.list_name);
    const changed = await connection.query<{ id: string }>(`WITH old AS (SELECT * FROM supplier_items WHERE id=$1 FOR UPDATE),
      updated AS (UPDATE supplier_items i SET product_data=$2,price_data=$3,stock_data=$4,price_count=$5,stock_count=$6,changed_at=now()
        FROM old WHERE i.id=old.id AND ROW(old.product_data,old.price_data,old.stock_data) IS DISTINCT FROM ROW($2::jsonb,$3::jsonb,$4::jsonb) RETURNING i.*)
      INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
      SELECT u.id,NULL,u.changed_at,'changed',jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence),
        jsonb_build_object('product',u.product_data,'price',u.price_data,'stock',u.stock_data,'conflicting',u.conflicting,'variants',u.source_variants,'presence',u.presence)
      FROM updated u JOIN old o ON o.id=u.id RETURNING item_id AS id`,
    [itemId, JSON.stringify(next.product_data), next.price_data && JSON.stringify(next.price_data), next.stock_data && JSON.stringify(next.stock_data), next.price_count, next.stock_count]);
    await writeEnrichments(connection, item.list_group, [{ code: item.code, row, category: categories.get(row.categoryId)!, image: row.imageUrl ? image!.stored.get(row.imageUrl) : undefined }]);
    await connection.query("COMMIT");
    return { changed: Boolean(changed.rowCount) };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    try { if (locked) await connection.query("SELECT pg_advisory_unlock($1,$2)", lock); }
    finally { connection.release(); }
  }
}
