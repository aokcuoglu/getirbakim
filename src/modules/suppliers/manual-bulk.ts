import type { Pool } from "pg";
import { manualCompany } from "./storefront-sources";
import { diffManualBulk, manualCost, type ManualBulkChange, type ManualBulkCurrent, type ManualBulkRow } from "./manual-bulk-csv";
import { lock, ManualImportError, manualSupplier, saveLockTimeout, type ManualBulk, type ManualDraftReport } from "./manual-import";
import type { ManualIssue } from "./manual-template";

// Bulk price/stock CSV of one manual list (#832; file format: manual-bulk-csv.ts). An upload is stored as a draft
// (manual_uploads.kind='bulk') with its diff; confirming recomputes the diff against the current rows and writes only
// what changed: list price and discount into the item's `bulk` override (so later xlsx uploads keep them, see
// ManualBulk), cost and stock into supplier_items (history in supplier_item_changes) and markup into
// commerce_product_pricing. Product data and enrichment are not touched.

export type ManualBulkReport = ManualDraftReport & { bulk: { unchanged: number; changes: ManualBulkChange[] } };
type Current = ManualBulkCurrent & { bulk: ManualBulk | null; priceData: Record<string, number> | null; stockData: Record<string, number> | null };

/** Every item of the list (all presence states) with what the CSV can change. */
export async function manualBulkCurrent(pool: Pick<Pool, "query">, listGroup: string) {
  return (await pool.query<Current>(`SELECT i.id,i.code,COALESCE(i.product_data->>'uk','') AS brand,
      COALESCE((i.price_data->>'list')::float8,(i.price_data->>'nf')::float8) AS list,COALESCE((i.price_data->>'discount')::float8,0) AS discount,
      p.markup_percent::float8 AS markup,(i.stock_data->>'stok')::float8 AS stock,(i.price_data->>'nf')::float8 AS cost,
      (i.product_data->'file'->>'price')::float8 AS "filePrice",(i.product_data->'file'->>'stock')::float8 AS "fileStock",
      COALESCE(ov.price_kurus IS NOT NULL OR ov.sale_price_kurus IS NOT NULL,false) AS "fixedPrice",
      o.fields->'bulk' AS bulk,i.price_data AS "priceData",i.stock_data AS "stockData"
    FROM supplier_items i LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
    LEFT JOIN manual_item_overrides o ON o.list_group=i.list_group AND o.code=i.code
    LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
    WHERE i.supplier=$1 AND i.company=$2 AND i.list_group=$3`, [manualSupplier, manualCompany, listGroup])).rows;
}

const count = (issues: ManualIssue[], level: ManualIssue["level"]) => issues.filter(issue => issue.level === level).length;

/** Stores a checked CSV for review; nothing changes until it is confirmed. */
export async function saveManualBulkDraft(pool: Pool, input: { listGroup: string; listName: string; fileName: string;
  parsed: { rows: ManualBulkRow[]; issues: ManualIssue[] }; by: string | null }) {
  const diff = diffManualBulk(input.parsed.rows, await manualBulkCurrent(pool, input.listGroup));
  const issues = [...input.parsed.issues, ...diff.issues].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const report: ManualBulkReport = {
    sheets: [], issues, errors: count(issues, "error"), warnings: count(issues, "warning"),
    // Every product line of the file: the valid ones and those refused while reading.
    products: new Set([...input.parsed.rows.map(row => row.row), ...input.parsed.issues.flatMap(issue => issue.row === null ? [] : [issue.row])]).size,
    added: 0, updated: diff.changes.length, removed: 0, removedCodes: [], bulk: { unchanged: diff.unchanged, changes: diff.changes },
  };
  return (await pool.query<{ id: string }>(`INSERT INTO manual_uploads(list_group,list_name,file_name,rows,report,uploaded_by,kind)
    VALUES($1,$2,$3,$4,$5,$6,'bulk') RETURNING id`, [input.listGroup, input.listName, input.fileName.slice(0, 200),
    JSON.stringify(input.parsed.rows), JSON.stringify(report), input.by])).rows[0].id;
}

/** Applies a reviewed CSV draft in one transaction; a draft with errors, or one whose recheck finds errors, is refused. */
export async function applyManualBulkDraft(pool: Pool, draftId: string, adminId: string) {
  const draft = (await pool.query<{ list_group: string; rows: ManualBulkRow[]; report: ManualBulkReport; status: string }>(
    "SELECT list_group,rows,report,status FROM manual_uploads WHERE id=$1 AND kind='bulk'", [draftId])).rows[0];
  if (!draft) throw new ManualImportError("not-found");
  if (draft.status !== "draft") throw new ManualImportError("decided");
  if (draft.report.errors) throw new ManualImportError("invalid");
  const connection = await pool.connect();
  let locked = false;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock($1,$2) AS locked", lock)).rows[0].locked;
    if (!locked) throw new ManualImportError("busy");
    await connection.query("BEGIN");
    // Same bound as the item page's save (#521): a product-match refresh can hold these rows for minutes.
    await connection.query(`SET LOCAL lock_timeout = '${saveLockTimeout}'`);
    const current = await manualBulkCurrent(connection, draft.list_group);
    const diff = diffManualBulk(draft.rows, current);
    if (diff.issues.some(issue => issue.level === "error")) throw new ManualImportError("invalid", "recheck");
    const byId = new Map(current.map(item => [item.id, item]));
    const overrides: { code: string; bulk: ManualBulk }[] = [];
    const items: { id: string; price_data: object | null; stock_data: object | null }[] = [];
    const markups: { id: string; markup: number }[] = [];
    const resets: string[] = [];
    for (const change of diff.changes) {
      const item = byId.get(change.id)!;
      const bulk: ManualBulk = { ...item.bulk };
      let priceData: object | null = null, stockData: object | null = null;
      if (change.listPrice || change.discount) {
        const list = change.listPrice?.[1] ?? item.list!;
        const discount = change.discount?.[1] ?? item.discount;
        bulk.price = { list, discount, file: item.filePrice };
        priceData = { ...item.priceData, nf: manualCost(list, discount), list, discount };
      }
      if (change.stock) {
        bulk.stock = { value: change.stock[1], file: item.fileStock };
        stockData = { ...item.stockData, stok: change.stock[1] };
      }
      if (priceData || stockData) {
        overrides.push({ code: item.code, bulk });
        items.push({ id: item.id, price_data: priceData, stock_data: stockData });
      }
      if (change.markup) {
        if (change.markup[1] === null) resets.push(item.id);
        else markups.push({ id: item.id, markup: change.markup[1] });
      }
    }
    if (overrides.length) await connection.query(`INSERT INTO manual_item_overrides(list_group,code,fields,updated_by)
      SELECT $1,x.code,jsonb_build_object('bulk',x.bulk),$2 FROM jsonb_to_recordset($3::jsonb) AS x(code text,bulk jsonb)
      ON CONFLICT(list_group,code) DO UPDATE SET fields=manual_item_overrides.fields || jsonb_build_object('bulk',EXCLUDED.fields->'bulk'),
        updated_by=EXCLUDED.updated_by,updated_at=now()`, [draft.list_group, adminId, JSON.stringify(overrides)]);
    // NO KEY UPDATE and the change history as in updateManualItem (#521); a NULL column keeps the stored value.
    if (items.length) await connection.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,price_data jsonb,stock_data jsonb)),
      old AS (SELECT i.* FROM supplier_items i JOIN x ON x.id=i.id WHERE i.supplier=$2 AND i.company=$3 AND i.list_group=$4 FOR NO KEY UPDATE OF i),
      next AS (SELECT o.id,COALESCE(x.price_data,o.price_data) AS price_data,COALESCE(x.stock_data,o.stock_data) AS stock_data,
        CASE WHEN x.price_data IS NULL THEN o.price_count ELSE 1 END AS price_count,CASE WHEN x.stock_data IS NULL THEN o.stock_count ELSE 1 END AS stock_count
        FROM old o JOIN x ON x.id=o.id),
      updated AS (UPDATE supplier_items i SET price_data=n.price_data,stock_data=n.stock_data,price_count=n.price_count,stock_count=n.stock_count,changed_at=now()
        FROM old o JOIN next n ON n.id=o.id WHERE i.id=o.id AND ROW(o.price_data,o.stock_data) IS DISTINCT FROM ROW(n.price_data,n.stock_data) RETURNING i.*)
      INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
      SELECT u.id,NULL,u.changed_at,'changed',jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence),
        jsonb_build_object('product',u.product_data,'price',u.price_data,'stock',u.stock_data,'conflicting',u.conflicting,'variants',u.source_variants,'presence',u.presence)
      FROM updated u JOIN old o ON o.id=u.id`, [JSON.stringify(items), manualSupplier, manualCompany, draft.list_group]);
    // Markup only: a product's own VAT rate stays; a reset row without one returns wholly to the global rates.
    if (markups.length) await connection.query(`INSERT INTO commerce_product_pricing(supplier_item_id,markup_percent,updated_by)
      SELECT x.id,x.markup,$2 FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,markup numeric)
      ON CONFLICT(supplier_item_id) DO UPDATE SET markup_percent=EXCLUDED.markup_percent,updated_at=now(),updated_by=EXCLUDED.updated_by`,
    [JSON.stringify(markups), adminId]);
    if (resets.length) {
      await connection.query("DELETE FROM commerce_product_pricing WHERE supplier_item_id=ANY($1::uuid[]) AND vat_percent IS NULL", [resets]);
      await connection.query(`UPDATE commerce_product_pricing SET markup_percent=NULL,updated_at=now(),updated_by=$2
        WHERE supplier_item_id=ANY($1::uuid[]) AND vat_percent IS NOT NULL`, [resets, adminId]);
    }
    const decided = await connection.query(`UPDATE manual_uploads SET status='imported',decided_at=now(),
      report=jsonb_set(report,'{bulk}',$2::jsonb) || jsonb_build_object('updated',$3::int) WHERE id=$1 AND status='draft'`,
    [draftId, JSON.stringify({ unchanged: diff.unchanged, changes: diff.changes }), diff.changes.length]);
    if (!decided.rowCount) throw new ManualImportError("decided");
    await connection.query("COMMIT");
    return { listGroup: draft.list_group, changed: diff.changes.length };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string }).code === "55P03") throw new ManualImportError("locked");
    throw error;
  } finally {
    try { if (locked) await connection.query("SELECT pg_advisory_unlock($1,$2)", lock); }
    finally { connection.release(); }
  }
}
