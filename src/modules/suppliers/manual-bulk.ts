import type { Pool } from "pg";
import { manualCompany } from "./storefront-sources";
import { diffManualBulk, manualBulkListCell, manualCost, type ManualBulkChange, type ManualBulkCurrent, type ManualBulkExportRow, type ManualBulkList, type ManualBulkRow } from "./manual-bulk-csv";
import { bulkFileCells, lock, ManualImportError, manualSupplier, saveLockTimeout, type ManualBulk, type ManualDraftReport } from "./manual-import";
import type { ManualIssue, ManualRow } from "./manual-template";
import { manualBulkPageSize } from "./manual-bulk-paging";
import type { ManualUpload } from "../admin/manual";

// Bulk price/stock CSV of one manual list (#832) or of all of them (#844; file format: manual-bulk-csv.ts). An upload
// is stored as one draft (manual_uploads.kind='bulk') with its diff; an all-lists file keeps each row's list in
// rows[].listGroup and the lists it names in report.bulk.lists (the draft's list_group then only routes the page).
// Confirming recomputes the diff against the current rows under one lock and in one transaction for every list, and
// writes only what changed: list price and discount into the item's `bulk` override (so later xlsx uploads keep them,
// see ManualBulk), cost and stock into supplier_items (history in supplier_item_changes) and markup into
// commerce_product_pricing. Product data and enrichment are not touched.

export type ManualBulkReport = ManualDraftReport & { bulk: { unchanged: number; changes: ManualBulkChange[];
  /** All-lists file (#844): the lists it names, in file order, with their row counts. */
  lists?: { group: string; name: string; rows: number }[] } };
type Current = ManualBulkCurrent & { bulk: ManualBulk | null; priceData: Record<string, number> | null; stockData: Record<string, number> | null };

/** Every manual list with its current name (all presence states), for resolving an all-lists file's Liste cells. */
export async function manualBulkLists(pool: Pick<Pool, "query">) {
  return (await pool.query<ManualBulkList>(`SELECT list_group AS "group",(array_agg(product_data->>'list_name' ORDER BY changed_at DESC))[1] AS name
    FROM supplier_items WHERE supplier=$1 AND company=$2 GROUP BY list_group ORDER BY list_group`, [manualSupplier, manualCompany])).rows;
}

/** The CSV's columns of a supplier_items row, shared by the single-list (admin/manual.ts) and all-lists downloads. */
export const manualBulkExportColumns = `COALESCE(supplier_items.product_data->>'uk','') AS brand,supplier_items.code,
  COALESCE((supplier_items.price_data->>'list')::float8,(supplier_items.price_data->>'nf')::float8) AS list,
  COALESCE((supplier_items.price_data->>'discount')::float8,0) AS discount,p.markup_percent::float8 AS markup,(supplier_items.stock_data->>'stok')::float8 AS stock`;
export const manualBulkExportFrom = "supplier_items LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=supplier_items.id";

/**
 * The all-lists CSV (#844): every list's present items with the list name the upload resolves (manualBulkLists); a
 * name shared by several lists is written as the slug. The product tab's filters belong to one list and do not apply.
 */
export async function manualBulkExportAll(pool: Pick<Pool, "query">) {
  const [lists, result] = await Promise.all([manualBulkLists(pool), pool.query<ManualBulkExportRow & { listGroup: string }>(
    `SELECT ${manualBulkExportColumns},supplier_items.list_group AS "listGroup" FROM ${manualBulkExportFrom}
    WHERE supplier_items.supplier=$1 AND supplier_items.company=$2 AND supplier_items.presence='present'
    ORDER BY supplier_items.list_group,supplier_items.code`, [manualSupplier, manualCompany])]);
  const names = new Map(lists.map(list => [list.group, manualBulkListCell(lists, list)]));
  return { lists, rows: result.rows.map(({ listGroup, ...row }): ManualBulkExportRow => ({ ...row, listName: names.get(listGroup) ?? listGroup })) };
}

/** Every item of the lists (all presence states) with what the CSV can change. */
export async function manualBulkCurrent(pool: Pick<Pool, "query">, listGroups: string[]) {
  return (await pool.query<Current>(`SELECT i.id,i.code,i.list_group AS "listGroup",COALESCE(i.product_data->>'uk','') AS brand,
      COALESCE((i.price_data->>'list')::float8,(i.price_data->>'nf')::float8) AS list,COALESCE((i.price_data->>'discount')::float8,0) AS discount,
      p.markup_percent::float8 AS markup,(i.stock_data->>'stok')::float8 AS stock,(i.price_data->>'nf')::float8 AS cost,
      (i.product_data->'file'->>'price')::float8 AS "filePrice",(i.product_data->'file'->>'stock')::float8 AS "fileStock",
      (i.product_data->'file'->>'listPrice')::float8 AS "fileList",(i.product_data->'file'->>'discount')::float8 AS "fileDiscount",
      COALESCE(ov.price_kurus IS NOT NULL OR ov.sale_price_kurus IS NOT NULL,false) AS "fixedPrice",
      o.fields->'bulk' AS bulk,i.price_data AS "priceData",i.stock_data AS "stockData"
    FROM supplier_items i LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
    LEFT JOIN manual_item_overrides o ON o.list_group=i.list_group AND o.code=i.code
    LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
    WHERE i.supplier=$1 AND i.company=$2 AND i.list_group=ANY($3::text[])`, [manualSupplier, manualCompany, listGroups])).rows;
}

const count = (issues: ManualIssue[], level: ManualIssue["level"]) => issues.filter(issue => issue.level === level).length;

const maxListName = 120;

/** Stores a checked CSV for review; nothing changes until it is confirmed. */
export async function saveManualBulkDraft(pool: Pool, input: { listGroup: string; listName: string; fileName: string;
  parsed: { rows: ManualBulkRow[]; issues: ManualIssue[]; combined?: boolean }; by: string | null }) {
  // The lists an all-lists file names, in file order (rows with an unknown list were refused while reading).
  const lists = new Map<string, { group: string; name: string; rows: number }>();
  if (input.parsed.combined) for (const row of input.parsed.rows) {
    const group = row.listGroup!;
    const entry = lists.get(group) ?? { group, name: row.listName ?? group, rows: 0 };
    entry.rows++;
    lists.set(group, entry);
  }
  const groups = input.parsed.combined ? [...lists.keys()] : [input.listGroup];
  const diff = diffManualBulk(input.parsed.rows, await manualBulkCurrent(pool, groups), input.listGroup);
  const issues = [...input.parsed.issues, ...diff.issues].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const report: ManualBulkReport = {
    sheets: [], issues, errors: count(issues, "error"), warnings: count(issues, "warning"),
    // Every product line of the file: the valid ones and those refused while reading.
    products: new Set([...input.parsed.rows.map(row => row.row), ...input.parsed.issues.flatMap(issue => issue.row === null ? [] : [issue.row])]).size,
    added: 0, updated: diff.changes.length, removed: 0, removedCodes: [],
    bulk: { unchanged: diff.unchanged, changes: diff.changes, ...(input.parsed.combined ? { lists: [...lists.values()] } : {}) },
  };
  // A file of one list is that list's draft; one of several keeps the page's list for routing and names them all.
  const named = [...lists.values()];
  const listGroup = named.length === 1 ? named[0].group : input.listGroup;
  const joined = named.map(list => list.name).join(", ");
  const listName = !named.length ? input.listName : joined.length > maxListName ? `${joined.slice(0, maxListName - 1)}…` : joined;
  return (await pool.query<{ id: string }>(`INSERT INTO manual_uploads(list_group,list_name,file_name,rows,report,uploaded_by,kind)
    VALUES($1,$2,$3,$4,$5,$6,'bulk') RETURNING id`, [listGroup, listName, input.fileName.slice(0, 200),
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
    // Old drafts' rows carry no list: they belong to the draft's.
    const groups = [...new Set(draft.rows.map(row => row.listGroup ?? draft.list_group))];
    const current = await manualBulkCurrent(connection, groups);
    const diff = diffManualBulk(draft.rows, current, draft.list_group);
    if (diff.issues.some(issue => issue.level === "error")) throw new ManualImportError("invalid", "recheck");
    const byId = new Map(current.map(item => [item.id, item]));
    const overrides: { list_group: string; code: string; bulk: ManualBulk }[] = [];
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
        bulk.price = { list, discount, ...bulkFileCells({ price: item.filePrice, listPrice: item.fileList ?? undefined, discount: item.fileDiscount ?? undefined }) };
        priceData = { ...item.priceData, nf: manualCost(list, discount), list, discount };
      }
      if (change.stock) {
        bulk.stock = { value: change.stock[1], file: item.fileStock };
        stockData = { ...item.stockData, stok: change.stock[1] };
      }
      if (priceData || stockData) {
        overrides.push({ list_group: item.listGroup ?? draft.list_group, code: item.code, bulk });
        items.push({ id: item.id, price_data: priceData, stock_data: stockData });
      }
      if (change.markup) {
        if (change.markup[1] === null) resets.push(item.id);
        else markups.push({ id: item.id, markup: change.markup[1] });
      }
    }
    if (overrides.length) await connection.query(`INSERT INTO manual_item_overrides(list_group,code,fields,updated_by)
      SELECT x.list_group,x.code,jsonb_build_object('bulk',x.bulk),$1 FROM jsonb_to_recordset($2::jsonb) AS x(list_group text,code text,bulk jsonb)
      ON CONFLICT(list_group,code) DO UPDATE SET fields=manual_item_overrides.fields || jsonb_build_object('bulk',EXCLUDED.fields->'bulk'),
        updated_by=EXCLUDED.updated_by,updated_at=now()`, [adminId, JSON.stringify(overrides)]);
    // NO KEY UPDATE and the change history as in updateManualItem (#521); a NULL column keeps the stored value.
    if (items.length) await connection.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,price_data jsonb,stock_data jsonb)),
      old AS (SELECT i.* FROM supplier_items i JOIN x ON x.id=i.id WHERE i.supplier=$2 AND i.company=$3 AND i.list_group=ANY($4::text[]) FOR NO KEY UPDATE OF i),
      next AS (SELECT o.id,COALESCE(x.price_data,o.price_data) AS price_data,COALESCE(x.stock_data,o.stock_data) AS stock_data,
        CASE WHEN x.price_data IS NULL THEN o.price_count ELSE 1 END AS price_count,CASE WHEN x.stock_data IS NULL THEN o.stock_count ELSE 1 END AS stock_count
        FROM old o JOIN x ON x.id=o.id),
      updated AS (UPDATE supplier_items i SET price_data=n.price_data,stock_data=n.stock_data,price_count=n.price_count,stock_count=n.stock_count,changed_at=now()
        FROM old o JOIN next n ON n.id=o.id WHERE i.id=o.id AND ROW(o.price_data,o.stock_data) IS DISTINCT FROM ROW(n.price_data,n.stock_data) RETURNING i.*)
      INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
      SELECT u.id,NULL,u.changed_at,'changed',jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence),
        jsonb_build_object('product',u.product_data,'price',u.price_data,'stock',u.stock_data,'conflicting',u.conflicting,'variants',u.source_variants,'presence',u.presence)
      FROM updated u JOIN old o ON o.id=u.id`, [JSON.stringify(items), manualSupplier, manualCompany, groups]);
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
    [draftId, JSON.stringify({ unchanged: diff.unchanged, changes: diff.changes, ...(draft.report.bulk.lists ? { lists: draft.report.bulk.lists } : {}) }), diff.changes.length]);
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

/** A draft upload with its first ten file rows (`preview`) and the file's row count (xlsx drafts). */
export type ManualDraft = Omit<ManualUpload, "stats" | "quality"> & { preview: ManualRow[]; row_count: number;
  /** CSV drafts: report.bulk.changes / report.issues carry only the requested page; these are the full counts. */
  change_count: number; issue_count: number };

/**
 * One draft for the review page (#840). A CSV draft returns a page of `manualBulkPageSize` changes and of findings
 * (errors first, then file order) sliced in SQL; the requested pages are clamped to the last one. Other drafts come back whole.
 */
export async function manualDraft(pool: Pick<Pool, "query">, id: string, changesPage: number, issuesPage: number) {
  return (await pool.query<ManualDraft>(`SELECT u.id,u.list_group,u.list_name,u.file_name,u.status,u.kind,
      CASE WHEN u.kind='bulk' THEN jsonb_set(jsonb_set(u.report,'{bulk,changes}',
        coalesce(jsonb_path_query_array(u.report#>'{bulk,changes}','$[$from to $to]',jsonb_build_object('from',p.change_offset,'to',p.change_offset+$3::int-1)),'[]'::jsonb)),'{issues}',
        (SELECT coalesce(jsonb_agg(i.issue ORDER BY i.warning,i.ord),'[]'::jsonb) FROM (SELECT t.issue,t.issue->>'level'='warning' AS warning,t.ord
          FROM jsonb_array_elements(u.report->'issues') WITH ORDINALITY AS t(issue,ord) ORDER BY warning,t.ord OFFSET p.issue_offset LIMIT $3::int) i))
        ELSE u.report END AS report,
      coalesce(jsonb_array_length(u.report#>'{bulk,changes}'),0) AS change_count,jsonb_array_length(u.report->'issues') AS issue_count,
      u.created_at,u.decided_at,u.import_id,a.name AS uploader,
      jsonb_path_query_array(u.rows,'$[0 to 9]') AS preview,jsonb_array_length(u.rows) AS row_count
      FROM manual_uploads u LEFT JOIN accounts a ON a.id=u.uploaded_by
      CROSS JOIN LATERAL (SELECT -- the requested pages, clamped to the last one (same math as manualBulkPage)
        (least(greatest($2::int,1),greatest(ceil(coalesce(jsonb_array_length(u.report#>'{bulk,changes}'),0)/$3::numeric),1)::int)-1)*$3::int AS change_offset,
        (least(greatest($4::int,1),greatest(ceil(jsonb_array_length(u.report->'issues')/$3::numeric),1)::int)-1)*$3::int AS issue_offset) p
      WHERE u.id=$1`, [id, changesPage, manualBulkPageSize, issuesPage])).rows[0];
}
