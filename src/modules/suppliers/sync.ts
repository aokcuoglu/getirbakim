import type { PoolClient } from "pg";

export type SupplierScope = { supplier: "basbug" | "dinamik"; company: string; group: string; warehouse: string };
export type ObservationItem = {
  code: string; product_data: Record<string, unknown>; price_data: Record<string, unknown> | null;
  stock_data: Record<string, unknown> | null; product_count: number; price_count: number;
  stock_count: number; conflicting: boolean; source_variants: Record<string, unknown>;
};
export type SyncStats = { added: number; changed: number; unchanged: number; missing: number; inactive: number; restored: number };

// All thresholds are conservative operational defaults, not claims about upstream completeness.
export function rejectionReason(current: { uniqueProducts: number; missingPrices: number; missingStocks: number }, previous?: typeof current): string | null {
  if (!current.uniqueProducts) return "empty-products";
  if (!previous?.uniqueProducts) return null;
  if (current.uniqueProducts < previous.uniqueProducts * 0.8) return "product-drop-over-20-percent";
  if (current.missingPrices / current.uniqueProducts > previous.missingPrices / previous.uniqueProducts + 0.1) return "missing-prices-increased-over-10-points";
  if (current.missingStocks / current.uniqueProducts > previous.missingStocks / previous.uniqueProducts + 0.1) return "missing-stocks-increased-over-10-points";
  return null;
}

// Caller owns the transaction and supplier lock. No API calls inside this transaction.
export async function applySupplierSnapshot(client: PoolClient, scope: SupplierScope, importId: string, items: ObservationItem[], observedAt: Date, updatePresence = true): Promise<SyncStats> {
  if (!items.length || new Set(items.map(i => i.code)).size !== items.length) throw new Error("A non-empty, unique, complete snapshot is required");
  const keys = [scope.supplier, scope.company, scope.group, scope.warehouse];
  await client.query(`CREATE TEMP TABLE sync_incoming ON COMMIT DROP AS
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(code text,product_data jsonb,price_data jsonb,stock_data jsonb,
    product_count integer,price_count integer,stock_count integer,conflicting boolean,source_variants jsonb)`, [JSON.stringify(items)]);
  await client.query("CREATE UNIQUE INDEX ON sync_incoming(code)");
  // Keep the previous state only for actual changes. JSONB equality ignores object key order.
  await client.query(`CREATE TEMP TABLE sync_delta ON COMMIT DROP AS
    SELECT n.*,o.id AS old_id,
      CASE WHEN o.id IS NULL THEN 'added' WHEN o.presence<>'present' THEN 'restored' ELSE 'changed' END AS kind,
      CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,
        'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence) END AS before_data
    FROM sync_incoming n LEFT JOIN supplier_items o ON o.supplier=$1 AND o.company=$2 AND o.list_group=$3 AND o.warehouse=$4 AND o.code=n.code
    WHERE o.id IS NULL OR o.presence<>'present' OR
      ROW(o.product_data,o.price_data,o.stock_data,o.conflicting,o.source_variants) IS DISTINCT FROM
      ROW(n.product_data,n.price_data,n.stock_data,n.conflicting,n.source_variants)`, keys);
  const counts = (await client.query<{ kind: "added" | "changed" | "restored"; count: string }>("SELECT kind,count(*) FROM sync_delta GROUP BY kind")).rows;
  const stats: SyncStats = { added: 0, changed: 0, restored: 0, unchanged: 0, missing: 0, inactive: 0 };
  for (const row of counts) stats[row.kind] = Number(row.count);
  stats.unchanged = items.length - stats.added - stats.changed - stats.restored;
  await client.query(`INSERT INTO supplier_items
    (supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,conflicting,source_variants,first_seen_at,last_seen_at,changed_at,last_import_id)
    SELECT $1,$2,$3,$4,code,product_data,price_data,stock_data,product_count,price_count,stock_count,conflicting,source_variants,$5,$5,$5,$6 FROM sync_delta
    ON CONFLICT(supplier,company,list_group,warehouse,code) DO UPDATE SET
      product_data=EXCLUDED.product_data,price_data=EXCLUDED.price_data,stock_data=EXCLUDED.stock_data,
      product_count=EXCLUDED.product_count,price_count=EXCLUDED.price_count,stock_count=EXCLUDED.stock_count,
      conflicting=EXCLUDED.conflicting,source_variants=EXCLUDED.source_variants,presence='present',missing_count=0,
      last_seen_at=EXCLUDED.last_seen_at,last_import_id=EXCLUDED.last_import_id,
      changed_at=CASE WHEN EXISTS(SELECT 1 FROM sync_delta d WHERE d.code=EXCLUDED.code) THEN EXCLUDED.changed_at ELSE supplier_items.changed_at END`, [...keys, observedAt, importId]);
  // Unchanged JSON payloads stay untouched; only observation metadata and quality counts advance.
  await client.query(`UPDATE supplier_items o SET last_seen_at=$5,last_import_id=$6,
      product_count=n.product_count,price_count=n.price_count,stock_count=n.stock_count
    FROM sync_incoming n WHERE o.supplier=$1 AND o.company=$2 AND o.list_group=$3 AND o.warehouse=$4 AND o.code=n.code
      AND NOT EXISTS(SELECT 1 FROM sync_delta d WHERE d.code=n.code)`, [...keys, observedAt, importId]);
  await client.query(`INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
    SELECT o.id,$5,$6,d.kind,d.before_data,jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,
      'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence)
    FROM sync_delta d JOIN supplier_items o ON o.supplier=$1 AND o.company=$2 AND o.list_group=$3 AND o.warehouse=$4 AND o.code=d.code`, [...keys, importId, observedAt]);
  if (updatePresence) {
  const missing = await client.query<{ presence: "pending_missing" | "inactive" }>(`WITH absent AS (
    SELECT o.id,jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,
      'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence) AS before_data
    FROM supplier_items o WHERE supplier=$1 AND company=$2 AND list_group=$3 AND warehouse=$4 AND presence<>'inactive'
      AND NOT EXISTS(SELECT 1 FROM sync_incoming n WHERE n.code=o.code)
  ), updated AS (
    UPDATE supplier_items o SET missing_count=o.missing_count+1,
      presence=CASE WHEN o.missing_count+1>=2 THEN 'inactive' ELSE 'pending_missing' END,changed_at=$6
    FROM absent a WHERE o.id=a.id RETURNING o.*
  ), logged AS (
    INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
    SELECT o.id,$5,$6,CASE WHEN o.presence='inactive' THEN 'inactive' ELSE 'missing' END,a.before_data,
      jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data,
        'conflicting',o.conflicting,'variants',o.source_variants,'presence',o.presence)
    FROM updated o JOIN absent a ON a.id=o.id
  ) SELECT presence FROM updated`, [...keys, importId, observedAt]);
  for (const row of missing.rows) stats[row.presence === "inactive" ? "inactive" : "missing"]++;
  }
  await client.query("DROP TABLE sync_delta, sync_incoming");
  return stats;
}

export async function migrateSupplierSnapshots(client: PoolClient) {
  // Same lock as importer/scheduler, so replay cannot race a live import.
  await client.query("SELECT pg_advisory_xact_lock(20261001,1)");
  if ((await client.query("SELECT 1 FROM supplier_sync_migrations WHERE name='current-items-v1'")).rowCount) return;
  const runs = await client.query<SupplierScope & { id: string; list_group: string; completed_at: Date }>(
    "SELECT * FROM supplier_imports WHERE status='succeeded' ORDER BY completed_at,id");
  for (const run of runs.rows) {
    const items = (await client.query<ObservationItem>("SELECT * FROM supplier_import_items WHERE import_id=$1 ORDER BY code", [run.id])).rows;
    if (!items.length) continue;
    const stats = await applySupplierSnapshot(client, { ...run, group: run.list_group }, run.id, items, run.completed_at);
    await client.query("UPDATE supplier_imports SET stats=$2 WHERE id=$1", [run.id, JSON.stringify(stats)]);
    await client.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,last_success_at,next_run_at)
      VALUES($1,$2,$3,$4,$5,$6,((($6::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+time '03:00') AT TIME ZONE 'Europe/Istanbul') ON CONFLICT(supplier,company,list_group,warehouse)
      DO UPDATE SET last_success_at=EXCLUDED.last_success_at,next_run_at=EXCLUDED.next_run_at`, [run.supplier,run.company,run.list_group,run.warehouse,run.supplier === "basbug",run.completed_at]);
  }
  // Historical differences have been replayed; retain only the latest legacy full copy per scope.
  await client.query(`DELETE FROM supplier_import_items i USING supplier_imports r WHERE i.import_id=r.id
    AND EXISTS(SELECT 1 FROM supplier_imports n WHERE n.supplier=r.supplier AND n.company=r.company
      AND n.list_group=r.list_group AND n.warehouse=r.warehouse AND n.status='succeeded'
      AND (n.completed_at,n.id)>(r.completed_at,r.id))`);
  await client.query("INSERT INTO supplier_sync_migrations(name) VALUES('current-items-v1')");
}

// No current rows or referenced runs are removed. Raw legacy copies: 7d; changes: 90d; run metadata: 365d.
export async function pruneSupplierHistory(client: PoolClient) {
  const raw = await client.query("DELETE FROM supplier_import_items i USING supplier_imports r WHERE i.import_id=r.id AND r.completed_at<now()-interval '7 days'");
  const changes = await client.query("DELETE FROM supplier_item_changes WHERE changed_at<now()-interval '90 days'");
  const runs = await client.query(`DELETE FROM supplier_imports r WHERE r.status<>'running' AND r.completed_at<now()-interval '365 days'
    AND NOT EXISTS(SELECT 1 FROM supplier_items i WHERE i.last_import_id=r.id)
    AND NOT EXISTS(SELECT 1 FROM supplier_item_changes c WHERE c.import_id=r.id)
    AND NOT EXISTS(SELECT 1 FROM supplier_import_items i WHERE i.import_id=r.id)
    AND (r.status<>'succeeded' OR EXISTS(SELECT 1 FROM supplier_imports n WHERE n.supplier=r.supplier AND n.company=r.company
      AND n.list_group=r.list_group AND n.warehouse=r.warehouse AND n.status='succeeded' AND n.run_kind=r.run_kind AND (n.completed_at,n.id)>(r.completed_at,r.id)))`);
  return { raw: raw.rowCount, changes: changes.rowCount, runs: runs.rowCount };
}
