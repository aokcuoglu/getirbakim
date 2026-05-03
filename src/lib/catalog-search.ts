import {
  getCatalogPool,
  getCatalogTableName,
  getCatalogSchema,
  isCatalogDbEnabled,
  getCatalogSearchSource,
} from "@/lib/catalog-db";

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

export interface SearchTimings {
  total_duration_ms: number;
  db_search_duration_ms: number;
  facet_duration_ms: number;
  oem_duration_ms: number;
  cache_duration_ms: number;
  result_mapping_duration_ms: number;
  cacheHit: boolean;
  page: number;
  limit: number;
  includeFacets: boolean;
  includeOems: boolean;
  dataSource: string;
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
  page: number;
  limit: number;
  hasMore: boolean;
  resultCountShown: number;
  totalEstimate: number | null;
  timings?: SearchTimings;
}

const PREFERRED_COLUMNS = [
  "id",
  "provider_id",
  "supplier_product_key",
  "supplier_sku",
  "supplier_brand",
  "supplier_name",
  "normalized_sku",
  "normalized_name",
  "barcode_1",
  "barcode_2",
  "barcode_3",
  "supplier_price",
  "supplier_stock_qty",
  "currency",
  "image_url",
  "last_seen_at",
  "created_at",
  "updated_at",
  "supplier_category",
];

function buildFastColumnsSql(existing: Set<string>): string {
  return PREFERRED_COLUMNS.filter(c => existing.has(c)).map(c => `sp.${c}`).join(", ");
}

let providerCache: Map<number, string> | null = null;
let providerCacheAt = 0;
const PROVIDER_CACHE_TTL = 300_000;

export async function getProviderNames(pool: InstanceType<typeof import("pg")["Pool"]>): Promise<Map<number, string>> {
  if (providerCache && Date.now() - providerCacheAt < PROVIDER_CACHE_TTL) return providerCache;
  try {
    const result = await pool.query("SELECT id, name FROM supplier_providers ORDER BY id");
    providerCache = new Map<number, string>();
    for (const row of result.rows as ProviderRow[]) {
      providerCache.set(row.id, row.name);
    }
    providerCacheAt = Date.now();
    return providerCache;
  } catch {
    if (!providerCache) providerCache = new Map<number, string>();
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

function normalizeCatalogRow(row: Record<string, unknown>, providers: Map<number, string>) {
  const providerName = normalizeProviderName(getProviderName(row.provider_id as number, providers));

  return {
    id: `db-${row.id}`,
    supplierProductId: row.id as number,
    supplierProductCode: row.supplier_product_key as string,
    supplierSku: row.supplier_sku as string,
    name: (row.supplier_name as string) ?? (row.supplier_sku as string),
    brand: row.supplier_brand as string | null,
    category: (row.supplier_category as string | null | undefined) ?? null,
    description: null,
    image_url: row.image_url && (row.image_url as string).trim() ? (row.image_url as string).trim() : null,
    oemNumbers: [] as string[],
    price: Number(row.supplier_price) || 0,
    currency: (row.currency as string) || "TRY",
    stockQuantity: (row.supplier_stock_qty as number) ?? 0,
    stockStatus: ((row.supplier_stock_qty as number) ?? 0) > 0 ? ("var" as const) : ("yok" as const),
    supplierName: providerName,
    providerId: row.provider_id as number,
    barcode: row.barcode_1 as string | null ?? null,
    barcode2: row.barcode_2 as string | null ?? null,
    barcode3: row.barcode_3 as string | null ?? null,
    normalizedSku: row.normalized_sku as string | null,
    normalizedName: row.normalized_name as string | null,
    lastCheckedAt: (row.updated_at as string) ?? (row.last_seen_at as string) ?? (row.created_at as string),
    dataSource: "existing-db" as const,
  };
}

function isSkuLike(query: string): boolean {
  const cleaned = query.replace(/[\s\-\.]/g, "");
  if (cleaned.length < 4) return false;
  if (!/^[A-Z0-9]+$/i.test(cleaned)) return false;
  if (!/[0-9]/.test(cleaned)) return false;
  return true;
}

function classifyQuery(query: string): "sku_like" | "oem_like" | "text" {
  if (isSkuLike(query)) {
    const cleaned = query.replace(/[\s\-\.]/g, "").toUpperCase();
    if (/^[A-Z]+[0-9]/.test(cleaned)) return "sku_like";
    return "oem_like";
  }
  return "text";
}

const EXISTING_COLUMNS = new Set<string>();
let columnsFetchedAt = 0;
const COLUMNS_CACHE_TTL = 600_000;

async function getExistingColumns(pool: InstanceType<typeof import("pg")["Pool"]>, schema: string, tableName: string): Promise<Set<string>> {
  if (EXISTING_COLUMNS.size > 0 && Date.now() - columnsFetchedAt < COLUMNS_CACHE_TTL) {
    return EXISTING_COLUMNS;
  }
  const colCheck = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [schema, tableName],
  );
  const cols = new Set(colCheck.rows.map((r: { column_name: string }) => r.column_name));
  for (const c of cols) EXISTING_COLUMNS.add(c);
  columnsFetchedAt = Date.now();
  return EXISTING_COLUMNS;
}

function buildSearchRelevanceQuery(
  query: string,
  filters: CatalogSearchFilters,
  columnNames: Set<string>,
  schema: string,
  tableName: string,
  skuLike: boolean,
  limitPlusOne: number,
  offset: number,
) {
  const params: unknown[] = [];
  let paramIdx = 1;

  const searchParts: string[] = [];
  const likeParam = `%${query}%`;

  if (skuLike) {
    searchParts.push(`sp.supplier_sku = $${paramIdx}::text`);
    params.push(query);
    paramIdx++;

    if (columnNames.has("normalized_sku")) {
      const normalizedQ = query.replace(/[\s\-\.]/g, "").toUpperCase();
      searchParts.push(`sp.normalized_sku = $${paramIdx}::text`);
      params.push(normalizedQ);
      paramIdx++;
    }

    for (const bc of ["barcode_1", "barcode_2", "barcode_3"]) {
      if (columnNames.has(bc)) {
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
      if (columnNames.has(col)) {
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
      if (columnNames.has(col)) {
        searchParts.push(`sp.${col} ILIKE $${paramIdx}::text`);
        params.push(likeParam);
        paramIdx++;
      }
    }
  } else {
    for (const col of ["supplier_name", "supplier_brand", "normalized_name", "supplier_sku", "normalized_sku", "barcode_1", "barcode_2", "barcode_3"]) {
      if (columnNames.has(col)) {
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
  params.push(limitPlusOne);
  paramIdx++;
  params.push(offset);

  return {
    whereClause,
    whereParams: params.slice(0, whereParamsEnd - 1),
    allParams: params,
    orderByClause,
    limitParam,
    offsetParam: limitParam + 1,
    totalParamsCount: paramIdx,
  };
}


export async function searchCatalogDb(
  query: string,
  filters: CatalogSearchFilters = {},
  page: number = 1,
  limit: number = 24,
  includeFacets: boolean = false,
  includeOems: boolean = false,
): Promise<CatalogSearchResult | null> {
  const timings: SearchTimings = {
    total_duration_ms: 0,
    db_search_duration_ms: 0,
    facet_duration_ms: 0,
    oem_duration_ms: 0,
    cache_duration_ms: 0,
    result_mapping_duration_ms: 0,
    cacheHit: false,
    page,
    limit,
    includeFacets,
    includeOems,
    dataSource: "existing-db",
  };

  const totalStart = Date.now();

  if (!isCatalogDbEnabled() || getCatalogSearchSource() !== "existing-db") {
    return null;
  }

  if (!query.trim()) {
    return null;
  }

  const pool = getCatalogPool();
  const schema = getCatalogSchema();
  const tableName = getCatalogTableName();

  const q = query.trim();
  const skuLike = isSkuLike(q);
  const safeQueryType = classifyQuery(q);
  const likeParam = `%${q}%`;

  const effectiveLimit = Math.min(Math.max(limit, 1), 48);
  const effectivePage = Math.max(page, 1);
  const limitPlusOne = effectiveLimit + 1;
  const offset = (effectivePage - 1) * effectiveLimit;

  const columnNames = await getExistingColumns(pool, schema, tableName);
  const fastColumnsSql = buildFastColumnsSql(columnNames);

  const searchBuilder = buildSearchRelevanceQuery(q, filters, columnNames, schema, tableName, skuLike, limitPlusOne, offset);

  try {
    const dbSearchStart = Date.now();
    const providerStart = Date.now();
    const providers = await getProviderNames(pool);
    const providerMs = Date.now() - providerStart;

    let queryStart: number;
    let queryMs: number;

    if (!skuLike) {
      const idSearchStart = Date.now();

      const trgmCols: string[] = [];
      for (const col of ["normalized_name", "supplier_name"]) {
        if (columnNames.has(col)) trgmCols.push(col);
      }

      const idResult = trgmCols.length >= 2
        ? await pool.query(
            `WITH matches AS (
              SELECT sp.id, 0 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.normalized_name ILIKE $1::text
              UNION
              SELECT sp.id, 0 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.supplier_name ILIKE $1::text
              UNION
              SELECT sp.id, 0 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.supplier_brand ILIKE $1::text
              UNION
              SELECT sp.id, 1 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.supplier_sku ILIKE $1::text
              UNION
              SELECT sp.id, 1 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.normalized_sku ILIKE $1::text
              ${columnNames.has("barcode_1") ? `UNION SELECT sp.id, 1 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.barcode_1 ILIKE $1::text` : ""}
              ${columnNames.has("barcode_2") ? `UNION SELECT sp.id, 1 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.barcode_2 ILIKE $1::text` : ""}
              ${columnNames.has("barcode_3") ? `UNION SELECT sp.id, 1 AS rank_boost FROM ${schema}.${tableName} sp WHERE sp.barcode_3 ILIKE $1::text` : ""}
              UNION
              SELECT spo.supplier_product_id AS id, 2 AS rank_boost FROM supplier_product_oems spo WHERE spo.is_active = true AND (spo.oem_code ILIKE $1::text OR spo.normalized_oem_code ILIKE $1::text)
            ),
            ranked AS (
              SELECT m.id, MIN(m.rank_boost) AS best_rank FROM matches m GROUP BY m.id
            )
            SELECT r.id FROM ranked r
            JOIN ${schema}.${tableName} sp ON sp.id = r.id
            ${filters.supplier ? `WHERE sp.provider_id IN (SELECT sp2.id FROM supplier_providers sp2 WHERE sp2.name ILIKE $2::text)` : ""}
            ORDER BY r.best_rank ASC, sp.supplier_stock_qty > 0 DESC, COALESCE(sp.supplier_price, 0) > 0 DESC, sp.updated_at DESC NULLS LAST
            LIMIT $${filters.supplier ? 3 : 2} OFFSET $${filters.supplier ? 4 : 3}`,
            filters.supplier
              ? [likeParam, `%${filters.supplier}%`, limitPlusOne, offset]
              : [likeParam, limitPlusOne, offset]
          )
        : await pool.query(
            `SELECT sp.id FROM ${schema}.${tableName} sp WHERE ${searchBuilder.whereClause} ORDER BY ${searchBuilder.orderByClause} LIMIT $${searchBuilder.limitParam} OFFSET $${searchBuilder.offsetParam}`,
            searchBuilder.allParams,
          );

      const idSearchMs = Date.now() - idSearchStart;

      const matchingIds = idResult.rows.map((r: Record<string, unknown>) => r.id as number);
      const hasMore = matchingIds.length > effectiveLimit;
      const pageIds = hasMore ? matchingIds.slice(0, effectiveLimit) : matchingIds;

      let rows: Record<string, unknown>[];
      if (pageIds.length > 0) {
        queryStart = Date.now();
        const detailResult = await pool.query(
          `SELECT ${fastColumnsSql} FROM ${schema}.${tableName} sp WHERE sp.id = ANY($1)`,
          [pageIds],
        );
        queryMs = Date.now() - queryStart;

        const idOrder = new Map(pageIds.map((id, idx) => [id, idx]));
        rows = detailResult.rows.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          return (idOrder.get(a.id as number) ?? 0) - (idOrder.get(b.id as number) ?? 0);
        });
      } else {
        rows = [];
        queryMs = 0;
      }

      timings.db_search_duration_ms = Date.now() - dbSearchStart;
      console.log(`[search-perf-detail] provider=${providerMs}ms id_search=${idSearchMs}ms detail=${queryMs}ms total_db=${timings.db_search_duration_ms}ms`);

      const productIds = pageIds;

      const oemStart = Date.now();
      const oemMap = new Map<number, string[]>();

      if (includeOems && productIds.length > 0) {
        const oemResult = await pool.query(
          `SELECT supplier_product_id, oem_code FROM supplier_product_oems WHERE supplier_product_id = ANY($1) AND is_active = true ORDER BY supplier_product_id, oem_code`,
          [productIds],
        );
        for (const row of oemResult.rows) {
          const pid = row.supplier_product_id as number;
          if (!oemMap.has(pid)) oemMap.set(pid, []);
          oemMap.get(pid)!.push(row.oem_code as string);
        }
      }
      timings.oem_duration_ms = Date.now() - oemStart;

      const mappingStart = Date.now();
      const products = rows.map((row: Record<string, unknown>) => {
        const normalized = normalizeCatalogRow(row, providers);
        const oems = oemMap.get(row.id as number) ?? [];
        return { ...normalized, oemNumbers: oems };
      });
      timings.result_mapping_duration_ms = Date.now() - mappingStart;

      let supplierCounts: Record<string, number>;
      let brandCounts: Record<string, number>;

      if (includeFacets) {
        const facetStart = Date.now();
        const facetResult = await pool.query(
          `SELECT sp.provider_id, sp.supplier_brand, COUNT(*)::bigint as cnt FROM ${schema}.${tableName} sp WHERE ${searchBuilder.whereClause} GROUP BY sp.provider_id, sp.supplier_brand`,
          searchBuilder.whereParams,
        );
        supplierCounts = {};
        brandCounts = {};
        for (const row of facetResult.rows) {
          const providerName = normalizeProviderName(getProviderName(row.provider_id as number, providers));
          supplierCounts[providerName] = (supplierCounts[providerName] || 0) + Number(row.cnt);
          if (row.supplier_brand) {
            brandCounts[row.supplier_brand as string] = (brandCounts[row.supplier_brand as string] || 0) + Number(row.cnt);
          }
        }
        timings.facet_duration_ms = Date.now() - facetStart;
      } else {
        supplierCounts = {};
        brandCounts = {};
        for (const product of products) {
          supplierCounts[product.supplierName] = (supplierCounts[product.supplierName] || 0) + 1;
          if (product.brand) {
            brandCounts[product.brand] = (brandCounts[product.brand] || 0) + 1;
          }
        }
      }

      timings.total_duration_ms = Date.now() - totalStart;

      console.log(`[search-perf] q_len=${q.length} type=${safeQueryType} db=${timings.db_search_duration_ms}ms oem=${timings.oem_duration_ms}ms facets=${timings.facet_duration_ms}ms map=${timings.result_mapping_duration_ms}ms total=${timings.total_duration_ms}ms page=${effectivePage} limit=${effectiveLimit} hasMore=${hasMore} facets=${includeFacets} oems=${includeOems}`);

      return {
        products,
        total: 0,
        query,
        dataSource: "existing-db",
        supplierCounts,
        brandCounts,
        appliedFilters: filters,
        liveFallbackUsed: false,
        errors: [],
        page: effectivePage,
        limit: effectiveLimit,
        hasMore,
        resultCountShown: products.length,
        totalEstimate: null,
        timings,
      };
    }

    queryStart = Date.now();
    const result = await pool.query(
      `SELECT ${fastColumnsSql} FROM ${schema}.${tableName} sp WHERE ${searchBuilder.whereClause} ORDER BY ${searchBuilder.orderByClause} LIMIT $${searchBuilder.limitParam} OFFSET $${searchBuilder.offsetParam}`,
      searchBuilder.allParams,
    );
    queryMs = Date.now() - queryStart;
    timings.db_search_duration_ms = Date.now() - dbSearchStart;

    console.log(`[search-perf-detail] provider=${providerMs}ms query=${queryMs}ms total_db=${timings.db_search_duration_ms}ms`);

    const hasMore = result.rows.length > effectiveLimit;
    const rows = hasMore ? result.rows.slice(0, effectiveLimit) : result.rows;
    const productIds = rows.map((r: Record<string, unknown>) => r.id as number);

    const oemStart = Date.now();
    const oemMap = new Map<number, string[]>();

    if (includeOems && productIds.length > 0) {
      const oemResult = await pool.query(
        `SELECT supplier_product_id, oem_code FROM supplier_product_oems WHERE supplier_product_id = ANY($1) AND is_active = true ORDER BY supplier_product_id, oem_code`,
        [productIds],
      );
      for (const row of oemResult.rows) {
        const pid = row.supplier_product_id as number;
        if (!oemMap.has(pid)) oemMap.set(pid, []);
        oemMap.get(pid)!.push(row.oem_code as string);
      }
    } else if (skuLike && productIds.length > 0) {
      const idPlaceholders = productIds.map((_, i) => `$${i + 1}`).join(", ");
      const oemResult = await pool.query(
        `SELECT supplier_product_id, oem_code FROM supplier_product_oems WHERE supplier_product_id IN (${idPlaceholders}) AND (oem_code = $${productIds.length + 1}::text OR normalized_oem_code = $${productIds.length + 1}::text) AND is_active = true`,
        [...productIds, q],
      );
      for (const row of oemResult.rows) {
        const pid = row.supplier_product_id as number;
        if (!oemMap.has(pid)) oemMap.set(pid, []);
        oemMap.get(pid)!.push(row.oem_code as string);
      }
    }
    timings.oem_duration_ms = Date.now() - oemStart;

    const mappingStart = Date.now();
    const products = rows.map((row: Record<string, unknown>) => {
      const normalized = normalizeCatalogRow(row, providers);
      const oems = oemMap.get(row.id as number) ?? [];
      return { ...normalized, oemNumbers: oems };
    });
    timings.result_mapping_duration_ms = Date.now() - mappingStart;

    let supplierCounts: Record<string, number>;
    let brandCounts: Record<string, number>;

    if (includeFacets) {
      const facetStart = Date.now();
      const facetResult = await pool.query(
        `SELECT sp.provider_id, sp.supplier_brand, COUNT(*)::bigint as cnt FROM ${schema}.${tableName} sp WHERE ${searchBuilder.whereClause} GROUP BY sp.provider_id, sp.supplier_brand`,
        searchBuilder.whereParams,
      );
      supplierCounts = {};
      brandCounts = {};
      for (const row of facetResult.rows) {
        const providerName = normalizeProviderName(getProviderName(row.provider_id as number, providers));
        supplierCounts[providerName] = (supplierCounts[providerName] || 0) + Number(row.cnt);
        if (row.supplier_brand) {
          brandCounts[row.supplier_brand as string] = (brandCounts[row.supplier_brand as string] || 0) + Number(row.cnt);
        }
      }
      timings.facet_duration_ms = Date.now() - facetStart;
    } else {
      supplierCounts = {};
      brandCounts = {};
      for (const product of products) {
        supplierCounts[product.supplierName] = (supplierCounts[product.supplierName] || 0) + 1;
        if (product.brand) {
          brandCounts[product.brand] = (brandCounts[product.brand] || 0) + 1;
        }
      }
    }

    timings.total_duration_ms = Date.now() - totalStart;

    console.log(`[search-perf] q_len=${q.length} type=${safeQueryType} db=${timings.db_search_duration_ms}ms oem=${timings.oem_duration_ms}ms facets=${timings.facet_duration_ms}ms map=${timings.result_mapping_duration_ms}ms total=${timings.total_duration_ms}ms page=${effectivePage} limit=${effectiveLimit} hasMore=${hasMore} facets=${includeFacets} oems=${includeOems}`);

    return {
      products,
      total: 0,
      query,
      dataSource: "existing-db",
      supplierCounts,
      brandCounts,
      appliedFilters: filters,
      liveFallbackUsed: false,
      errors: [],
      page: effectivePage,
      limit: effectiveLimit,
      hasMore,
      resultCountShown: products.length,
      totalEstimate: null,
      timings,
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
      page: effectivePage,
      limit: effectiveLimit,
      hasMore: false,
      resultCountShown: 0,
      totalEstimate: null,
      timings,
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
  providerCacheAt = 0;
}

export function clearColumnsCache(): void {
  EXISTING_COLUMNS.clear();
  columnsFetchedAt = 0;
}