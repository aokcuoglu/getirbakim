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
  oem_numbers: string[] | null;
  supplier_category: string | null;
}

interface ProviderRow {
  id: number;
  name: string;
}

export interface CatalogSearchFilters {
  supplier?: string;
  brand?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: "relevance" | "in_stock_first" | "price_asc" | "price_desc" | "updated_desc";
}

export interface CatalogSearchResult {
  products: ReturnType<typeof normalizeCatalogRow>[];
  total: number;
  query: string;
  dataSource: "existing-db";
  supplierCounts: Record<string, number>;
  brandCounts: Record<string, number>;
  appliedFilters: CatalogSearchFilters;
  liveFallbackUsed: boolean;
  errors: string[];
}

let providerCache: Map<number, string> | null = null;

export async function getProviderNames(pool: InstanceType<typeof import("pg")["Pool"]>): Promise<Map<number, string>> {
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
  dinamik: "Dinamik",
  parcatedarik: "Parçatedarik",
  seta: "Seta",
  "parca tedarik": "Parçatedarik",
};

export function normalizeProviderName(name: string): string {
  return SUPPLIER_DISPLAY_NAMES[name.toLowerCase().trim()] ?? name;
}

function normalizeCatalogRow(row: CatalogSearchRow, providers: Map<number, string>) {
  const providerName = normalizeProviderName(getProviderName(row.provider_id, providers));

  const oemNumbers: string[] = row.oem_numbers ?? [];

  return {
    id: `db-${row.id}`,
    supplierProductId: row.id,
    supplierProductCode: row.supplier_product_key,
    supplierSku: row.supplier_sku,
    name: row.supplier_name ?? row.supplier_sku,
    brand: row.supplier_brand,
    category: row.supplier_category,
    description: null,
    image_url: row.image_url && row.image_url.trim() ? row.image_url.trim() : null,
    oemNumbers,
    price: Number(row.supplier_price) || 0,
    currency: row.currency || "TRY",
    stockQuantity: row.supplier_stock_qty ?? 0,
    stockStatus: (row.supplier_stock_qty ?? 0) > 0 ? ("var" as const) : ("yok" as const),
    supplierName: providerName,
    providerId: row.provider_id,
    barcode: row.barcode_1 ?? null,
    barcode2: row.barcode_2 ?? null,
    barcode3: row.barcode_3 ?? null,
    normalizedSku: row.normalized_sku,
    normalizedName: row.normalized_name,
    lastCheckedAt: row.updated_at ?? row.last_seen_at ?? row.created_at,
    dataSource: "existing-db" as const,
  };
}

function isSkuLike(query: string): boolean {
  const cleaned = query.replace(/[\s\-\.]/g, "");
  return /^[A-Z0-9]{4,}$/i.test(cleaned);
}

function buildSearchRelevanceQuery(
  query: string,
  filters: CatalogSearchFilters,
  columnNames: string[],
  schema: string,
  tableName: string,
  skuLike: boolean,
) {
  const params: unknown[] = [];
  let paramIdx = 1;

  const searchParts: string[] = [];
  const likeParam = `%${query}%`;

  if (skuLike) {
    searchParts.push(`sp.supplier_sku = $${paramIdx}::text`);
    params.push(query);
    paramIdx++;

    if (columnNames.includes("normalized_sku")) {
      const normalizedQ = query.replace(/[\s\-\.]/g, "").toUpperCase();
      searchParts.push(`sp.normalized_sku = $${paramIdx}::text`);
      params.push(normalizedQ);
      paramIdx++;
    }

    for (const bc of ["barcode_1", "barcode_2", "barcode_3"]) {
      if (columnNames.includes(bc)) {
        searchParts.push(`sp.${bc} = $${paramIdx}::text`);
        params.push(query);
        paramIdx++;
      }
    }

    searchParts.push(`EXISTS (SELECT 1 FROM supplier_product_oems spo WHERE spo.supplier_product_id = sp.id AND spo.is_active = true AND (spo.oem_code = $${paramIdx}::text OR spo.normalized_oem_code = $${paramIdx}::text))`);
    params.push(query);
    paramIdx++;

    const fuzzyParts: string[] = [];
    for (const col of ["supplier_sku", "normalized_sku", "barcode_1", "barcode_2", "barcode_3", "supplier_brand"]) {
      if (columnNames.includes(col)) {
        fuzzyParts.push(`sp.${col} ILIKE $${paramIdx}::text`);
        params.push(likeParam);
        paramIdx++;
      }
    }
    if (fuzzyParts.length > 0) {
      searchParts.push(`(${fuzzyParts.join(" OR ")})`);
    }

    searchParts.push(`EXISTS (SELECT 1 FROM supplier_product_oems spo WHERE spo.supplier_product_id = sp.id AND spo.is_active = true AND (spo.oem_code ILIKE $${paramIdx}::text OR spo.normalized_oem_code ILIKE $${paramIdx}::text))`);
    params.push(likeParam);
    paramIdx++;

    for (const col of ["supplier_name", "normalized_name"]) {
      if (columnNames.includes(col)) {
        searchParts.push(`sp.${col} ILIKE $${paramIdx}::text`);
        params.push(likeParam);
        paramIdx++;
      }
    }
  } else {
    for (const col of ["supplier_name", "supplier_brand", "normalized_name", "supplier_sku", "normalized_sku", "barcode_1", "barcode_2", "barcode_3"]) {
      if (columnNames.includes(col)) {
        searchParts.push(`sp.${col} ILIKE $${paramIdx}::text`);
        params.push(likeParam);
        paramIdx++;
      }
    }

    searchParts.push(`EXISTS (SELECT 1 FROM supplier_product_oems spo WHERE spo.supplier_product_id = sp.id AND spo.is_active = true AND (spo.oem_code ILIKE $${paramIdx}::text OR spo.normalized_oem_code ILIKE $${paramIdx}::text))`);
    params.push(likeParam);
    paramIdx++;
  }

  const whereParts: string[] = [];
  if (searchParts.length > 0) {
    whereParts.push(`(${searchParts.join(" OR ")})`);
  }

  if (filters.supplier) {
    whereParts.push(`sp.provider_id IN (SELECT sp2.id FROM supplier_providers sp2 WHERE sp2.name ILIKE $${paramIdx}::text)`);
    params.push(`%${filters.supplier}%`);
    paramIdx++;
  }

  if (filters.brand) {
    whereParts.push(`sp.supplier_brand ILIKE $${paramIdx}::text`);
    params.push(`%${filters.brand}%`);
    paramIdx++;
  }

  if (filters.inStock === true) {
    whereParts.push(`sp.supplier_stock_qty > 0`);
  } else if (filters.inStock === false) {
    whereParts.push(`sp.supplier_stock_qty = 0`);
  }

  if (filters.minPrice !== undefined && filters.minPrice > 0) {
    whereParts.push(`sp.supplier_price >= $${paramIdx}::numeric`);
    params.push(filters.minPrice);
    paramIdx++;
  }

  if (filters.maxPrice !== undefined && filters.maxPrice > 0) {
    whereParts.push(`sp.supplier_price <= $${paramIdx}::numeric`);
    params.push(filters.maxPrice);
    paramIdx++;
  }

  const whereClause = whereParts.length > 0 ? whereParts.join(" AND ") : "1=1";

  const whereParamsEnd = paramIdx;

  let orderByClause: string;
  switch (filters.sort) {
    case "in_stock_first":
      orderByClause = `sp.supplier_stock_qty > 0 DESC, sp.updated_at DESC NULLS LAST`;
      break;
    case "price_asc":
      orderByClause = `sp.supplier_price ASC NULLS LAST`;
      break;
    case "price_desc":
      orderByClause = `sp.supplier_price DESC NULLS LAST`;
      break;
    case "updated_desc":
      orderByClause = `sp.updated_at DESC NULLS LAST`;
      break;
    case "relevance":
    default: {
      if (skuLike) {
        const exactSkuParam = paramIdx;
        params.push(query);
        paramIdx++;
        const prefixSkuParam = paramIdx;
        params.push(`${query}%`);
        paramIdx++;
        orderByClause = `
          CASE
            WHEN sp.supplier_sku = $${exactSkuParam}::text THEN 0
            WHEN sp.supplier_sku ILIKE $${prefixSkuParam}::text THEN 1
            WHEN sp.normalized_sku = $${exactSkuParam}::text THEN 2
            ELSE 3
          END,
          sp.supplier_stock_qty > 0 DESC,
          COALESCE(sp.supplier_price, 0) > 0 DESC,
          sp.updated_at DESC NULLS LAST`;
      } else {
        const exactBrandParam = paramIdx;
        params.push(query);
        paramIdx++;
        orderByClause = `
          sp.supplier_stock_qty > 0 DESC,
          COALESCE(sp.supplier_price, 0) > 0 DESC,
          CASE WHEN sp.supplier_brand ILIKE $${exactBrandParam}::text THEN 0 ELSE 1 END,
          sp.updated_at DESC NULLS LAST`;
      }
      break;
    }
  }

  const limitParam = paramIdx;
  params.push(100);
  paramIdx++;
  params.push(0);

  return {
    whereClause,
    orderByClause,
    countParams: params.slice(0, whereParamsEnd - 1),
    dataParams: params,
    dataParamsStart: limitParam,
  };
}

export async function searchCatalogDb(
  query: string,
  filters: CatalogSearchFilters = {},
): Promise<CatalogSearchResult | null> {
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
    [schema, tableName],
  );
  const columnNames = colCheck.rows.map((r: { column_name: string }) => r.column_name);

  const q = query.trim();
  const skuLike = isSkuLike(q);

  const searchBuilder = buildSearchRelevanceQuery(q, filters, columnNames, schema, tableName, skuLike);

  try {
    const providers = await getProviderNames(pool);

    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName} sp WHERE ${searchBuilder.whereClause}`,
      searchBuilder.countParams,
    );
    const total = Number(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT sp.* FROM ${schema}.${tableName} sp WHERE ${searchBuilder.whereClause} ORDER BY ${searchBuilder.orderByClause} LIMIT $${searchBuilder.dataParamsStart} OFFSET $${searchBuilder.dataParamsStart + 1}`,
      searchBuilder.dataParams,
    );

    const productIds = result.rows.map((r: Record<string, unknown>) => r.id as number);
    const oemMap = new Map<number, string[]>();

    if (productIds.length > 0) {
      const oemResult = await pool.query(
        `SELECT supplier_product_id, oem_code FROM supplier_product_oems WHERE supplier_product_id = ANY($1) AND is_active = true ORDER BY supplier_product_id, oem_code`,
        [productIds],
      );
      for (const row of oemResult.rows) {
        const pid = row.supplier_product_id as number;
        if (!oemMap.has(pid)) {
          oemMap.set(pid, []);
        }
        oemMap.get(pid)!.push(row.oem_code as string);
      }
    }

    const products = result.rows.map((row: Record<string, unknown>) => {
      const normalized = normalizeCatalogRow(row as unknown as CatalogSearchRow, providers);
      const oems = oemMap.get(row.id as number) ?? [];
      return { ...normalized, oemNumbers: oems };
    });

    const supplierCounts: Record<string, number> = {};
    const brandCounts: Record<string, number> = {};
    for (const product of products) {
      supplierCounts[product.supplierName] = (supplierCounts[product.supplierName] || 0) + 1;
      if (product.brand) {
        brandCounts[product.brand] = (brandCounts[product.brand] || 0) + 1;
      }
    }

    return {
      products,
      total,
      query,
      dataSource: "existing-db",
      supplierCounts,
      brandCounts,
      appliedFilters: filters,
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
      brandCounts: {},
      appliedFilters: filters,
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
  brandCounts?: Record<string, number>;
  productsWithOem?: number;
  productsWithoutOem?: number;
  productsWithPrice?: number;
  productsWithoutPrice?: number;
  productsWithStock?: number;
  productsWithoutStock?: number;
  columns?: { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[];
}> {
  if (!isCatalogDbEnabled()) {
    return { connected: false, error: "USE_EXISTING_CATALOG_DB is not enabled" };
  }

  try {
    const pool = getCatalogPool();
    const schema = getCatalogSchema();
    const tableName = getCatalogTableName();

    const tableCheck = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) as exists`,
      [schema, tableName],
    );

    if (!tableCheck.rows[0].exists) {
      return { connected: true, tableExists: false };
    }

    const columnsResult = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, tableName],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName}`,
    );

    const providers = await getProviderNames(pool);

    const supplierCounts: Record<string, number> = {};
    const providerCountResult = await pool.query(
      `SELECT provider_id, COUNT(*)::bigint as count FROM ${schema}.${tableName} WHERE provider_id IN (SELECT id FROM supplier_providers) GROUP BY provider_id ORDER BY count DESC`,
    );
    for (const row of providerCountResult.rows) {
      const name = normalizeProviderName(getProviderName(row.provider_id, providers));
      supplierCounts[name] = Number(row.count);
    }

    const brandCounts: Record<string, number> = {};
    const brandResult = await pool.query(
      `SELECT supplier_brand, COUNT(*)::bigint as count FROM ${schema}.${tableName} WHERE supplier_brand IS NOT NULL AND supplier_brand != '' GROUP BY supplier_brand ORDER BY count DESC LIMIT 30`,
    );
    for (const row of brandResult.rows) {
      if (row.supplier_brand) {
        brandCounts[row.supplier_brand] = Number(row.count);
      }
    }

    const productsWithOem = await pool.query(
      `SELECT COUNT(DISTINCT supplier_product_id)::bigint as count FROM supplier_product_oems WHERE is_active = true`,
    );
    const productsWithoutOem = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName} sp WHERE NOT EXISTS (SELECT 1 FROM supplier_product_oems spo WHERE spo.supplier_product_id = sp.id AND spo.is_active = true)`,
    );

    const productsWithPrice = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName} WHERE supplier_price IS NOT NULL AND supplier_price > 0`,
    );
    const productsWithoutPrice = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName} WHERE supplier_price IS NULL OR supplier_price = 0`,
    );

    const productsWithStock = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName} WHERE supplier_stock_qty > 0`,
    );
    const productsWithoutStock = await pool.query(
      `SELECT COUNT(*)::bigint as count FROM ${schema}.${tableName} WHERE supplier_stock_qty = 0`,
    );

    return {
      connected: true,
      tableExists: true,
      rowCount: Number(countResult.rows[0].count),
      supplierColumn: "provider_id → supplier_providers.name",
      supplierCounts,
      brandCounts,
      productsWithOem: Number(productsWithOem.rows[0].count),
      productsWithoutOem: Number(productsWithoutOem.rows[0].count),
      productsWithPrice: Number(productsWithPrice.rows[0].count),
      productsWithoutPrice: Number(productsWithoutPrice.rows[0].count),
      productsWithStock: Number(productsWithStock.rows[0].count),
      productsWithoutStock: Number(productsWithoutStock.rows[0].count),
      columns: columnsResult.rows as { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[],
    };
  } catch (err) {
    return {
      connected: false,
      error: (err as Error).message,
    };
  }
}

export function clearProviderCache(): void {
  providerCache = null;
}