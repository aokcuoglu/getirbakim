import {
  getCatalogPool,
  getCatalogTableName,
  getCatalogSchema,
  isCatalogDbEnabled,
  getCatalogSearchSource,
} from "@/lib/catalog-db";

interface CatalogSearchRow {
  id: number;
  provider_id: number;
  supplier_product_key: string;
  supplier_sku: string;
  supplier_brand: string | null;
  supplier_name: string | null;
  normalized_sku: string | null;
  normalized_name: string | null;
  barcode_1: string | null;
  barcode_2: string | null;
  barcode_3: string | null;
  supplier_price: number | null;
  supplier_stock_qty: number;
  currency: string;
  image_url: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderRow {
  id: number;
  name: string;
}

let providerCache: Map<number, string> | null = null;

async function getProviderNames(pool: InstanceType<typeof import("pg")["Pool"]>): Promise<Map<number, string>> {
  if (providerCache) return providerCache;
  try {
    const result = await pool.query("SELECT id, name FROM supplier_providers ORDER BY id");
    providerCache = new Map<number, string>();
    for (const row of result.rows as ProviderRow[]) {
      providerCache.set(row.id, row.name);
    }
    return providerCache;
  } catch {
    providerCache = new Map<number, string>();
    return providerCache;
  }
}

function getProviderName(providerId: number, providers: Map<number, string>): string {
  return providers.get(providerId) ?? `Provider ${providerId}`;
}

const SUPPLIER_DISPLAY_NAMES: Record<string, string> = {
  "dinamik": "Dinamik",
  "parcatedarik": "Parçatedarik",
  "seta": "Seta",
  "parca tedarik": "Parçatedarik",
};

function normalizeProviderName(name: string): string {
  return SUPPLIER_DISPLAY_NAMES[name.toLowerCase().trim()] ?? name;
}

function normalizeCatalogRow(row: CatalogSearchRow, providers: Map<number, string>) {
  const providerName = normalizeProviderName(getProviderName(row.provider_id, providers));

  return {
    id: `db-${row.id}`,
    name: row.supplier_name ?? row.supplier_sku,
    brand: row.supplier_brand,
    category: null,
    description: null,
    image_url: row.image_url && row.image_url.trim() ? row.image_url.trim() : null,
    oemNumbers: [] as string[],
    price: Number(row.supplier_price) || 0,
    currency: row.currency || "TRY",
    stockQuantity: row.supplier_stock_qty ?? 0,
    stockStatus: (row.supplier_stock_qty ?? 0) > 0 ? "var" : "yok",
    supplierName: providerName,
    supplierSku: row.supplier_sku,
    lastCheckedAt: row.updated_at ?? row.last_seen_at ?? row.created_at,
    dataSource: "existing-db" as const,
    barcode1: row.barcode_1,
    barcode2: row.barcode_2,
    barcode3: row.barcode_3,
    normalizedSku: row.normalized_sku,
    normalizedName: row.normalized_name,
  };
}

export interface CatalogSearchResult {
  products: ReturnType<typeof normalizeCatalogRow>[];
  total: number;
  query: string;
  dataSource: "existing-db";
  supplierCounts: Record<string, number>;
  liveFallbackUsed: boolean;
  errors: string[];
}

export async function searchCatalogDb(query: string): Promise<CatalogSearchResult | null> {
  if (!isCatalogDbEnabled() || getCatalogSearchSource() !== "existing-db") {
    return null;
  }

  if (!query.trim()) {
    return null;
  }

  const pool = getCatalogPool();
  const schema = getCatalogSchema();
  const tableName = getCatalogTableName();

  const colCheck = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [schema, tableName]
  );
  const columnNames = colCheck.rows.map((r: { column_name: string }) => r.column_name);

  const searchParam = `%${query.trim()}%`;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const searchableColumns = [
    "supplier_sku",
    "supplier_name",
    "supplier_brand",
    "normalized_sku",
    "normalized_name",
    "barcode_1",
    "barcode_2",
    "barcode_3",
  ];

  if (columnNames.includes("raw_json")) {
    conditions.push(`CAST(raw_json AS TEXT) ILIKE $${paramIdx}`);
    params.push(searchParam);
    paramIdx++;
  }

  for (const col of searchableColumns) {
    if (columnNames.includes(col)) {
      conditions.push(`${col} ILIKE $${paramIdx}`);
      params.push(searchParam);
      paramIdx++;
    }
  }

  if (conditions.length === 0) {
    return null;
  }

  const whereClause = conditions.map((c) => `(${c})`).join(" OR ");
  const tableNameFull = `${schema}.${tableName}`;

  try {
    const providers = await getProviderNames(pool);

    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${tableNameFull} WHERE ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT * FROM ${tableNameFull} WHERE ${whereClause} ORDER BY updated_at DESC NULLS LAST LIMIT 100`,
      params
    );

    const products = result.rows.map((row: Record<string, unknown>) =>
      normalizeCatalogRow(row as unknown as CatalogSearchRow, providers)
    );

    const supplierCounts: Record<string, number> = {};
    for (const product of products) {
      supplierCounts[product.supplierName] = (supplierCounts[product.supplierName] || 0) + 1;
    }

    return {
      products,
      total,
      query,
      dataSource: "existing-db",
      supplierCounts,
      liveFallbackUsed: false,
      errors: [],
    };
  } catch (err) {
    console.error("[catalog-search] DB search error:", (err as Error).message);
    return {
      products: [],
      total: 0,
      query,
      dataSource: "existing-db",
      supplierCounts: {},
      liveFallbackUsed: false,
      errors: [`Catalog DB search failed: ${(err as Error).message}`],
    };
  }
}

export async function getCatalogDbStats(): Promise<{
  connected: boolean;
  error?: string;
  tableExists?: boolean;
  rowCount?: number;
  supplierColumn?: string;
  supplierCounts?: Record<string, number>;
  columns?: { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[];
}> {
  if (!isCatalogDbEnabled()) {
    return { connected: false, error: "USE_EXISTING_CATALOG_DB is not enabled" };
  }

  try {
    const pool = getCatalogPool();
    const schema = getCatalogSchema();
    const tableName = getCatalogTableName();
    const tableNameFull = `${schema}.${tableName}`;

    const tableCheck = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) as exists`,
      [schema, tableName]
    );

    if (!tableCheck.rows[0].exists) {
      return { connected: true, tableExists: false };
    }

    const columnsResult = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, tableName]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${tableNameFull}`
    );

    const providers = await getProviderNames(pool);

    const supplierCounts: Record<string, number> = {};
    const providerCountResult = await pool.query(
      `SELECT provider_id, COUNT(*)::bigint as count FROM ${tableNameFull} GROUP BY provider_id ORDER BY count DESC`
    );
    for (const row of providerCountResult.rows) {
      const name = normalizeProviderName(getProviderName(row.provider_id, providers));
      supplierCounts[name] = Number(row.count);
    }

    return {
      connected: true,
      tableExists: true,
      rowCount: Number(countResult.rows[0].count),
      supplierColumn: "provider_id → supplier_providers.name",
      supplierCounts,
      columns: columnsResult.rows as { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[],
    };
  } catch (err) {
    return {
      connected: false,
      error: (err as Error).message,
    };
  }
}