import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/suppliers/search";
import { searchCatalogDb } from "@/lib/catalog-search";
import { isCatalogDbEnabled, getCatalogSearchSource, isLiveFallbackEnabled } from "@/lib/catalog-db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getCachedSearchResult, setCachedSearchResult } from "@/lib/search-cache";
import type { NormalizedProduct, NormalizedOffer } from "@/types";
import type { CatalogSearchFilters } from "@/lib/catalog-search";

interface SearchResponseProduct extends NormalizedProduct {
  dataSource?: string;
}

export async function GET(request: NextRequest) {
  const totalStart = Date.now();
  const ip = getClientIp(request.headers);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Çok fazla arama isteği. Lütfen biraz bekleyip tekrar deneyin.",
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({
      products: [],
      total: 0,
      query: "",
      errors: [],
      lastCheckedAt: new Date().toISOString(),
    });
  }

  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "24", 10) || 24, 1), 48);
  const includeFacets = searchParams.get("includeFacets") === "true";
  const includeOems = searchParams.get("includeOems") === "true";

  const filters: CatalogSearchFilters = {
    supplier: searchParams.get("supplier") ?? undefined,
    brand: searchParams.get("brand") ?? undefined,
    inStock: searchParams.get("inStock") === "true" ? true : searchParams.get("inStock") === "false" ? false : undefined,
    minPrice: searchParams.has("minPrice") ? Number(searchParams.get("minPrice")) : undefined,
    maxPrice: searchParams.has("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined,
    sort: (searchParams.get("sort") as CatalogSearchFilters["sort"]) ?? undefined,
  };

  if (!filters.supplier) delete (filters as Record<string, unknown>).supplier;
  if (!filters.brand) delete (filters as Record<string, unknown>).brand;
  if (filters.minPrice !== undefined && (isNaN(filters.minPrice) || filters.minPrice <= 0)) delete (filters as Record<string, unknown>).minPrice;
  if (filters.maxPrice !== undefined && (isNaN(filters.maxPrice) || filters.maxPrice <= 0)) delete (filters as Record<string, unknown>).maxPrice;
  if (!filters.sort) delete (filters as Record<string, unknown>).sort;

  const useExistingDb = isCatalogDbEnabled() && getCatalogSearchSource() === "existing-db";
  const catalogSource = getCatalogSearchSource();

  if (useExistingDb) {
    const cacheKey = {
      query: query.trim(),
      page,
      limit,
      supplier: filters.supplier,
      brand: filters.brand,
      inStock: filters.inStock,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      sort: filters.sort,
      includeFacets,
      includeOems,
      catalogSource,
    };

    const cacheStart = Date.now();
    const cached = getCachedSearchResult<{
      products: SearchResponseProduct[];
      total: number;
      query: string;
      errors: string[];
      dataSource: string;
      supplierCounts: Record<string, number>;
      brandCounts: Record<string, number>;
      appliedFilters: CatalogSearchFilters;
      liveFallbackUsed: boolean;
      lastCheckedAt: string;
      page: number;
      limit: number;
      hasMore: boolean;
      resultCountShown: number;
      totalEstimate: number | null;
      timings?: { total_duration_ms: number; db_search_duration_ms: number; facet_duration_ms: number; oem_duration_ms: number; cache_duration_ms: number; result_mapping_duration_ms: number; cacheHit: boolean };
    }>(cacheKey);
    const cacheDuration = Date.now() - cacheStart;

    if (cached) {
      console.log(`[search-perf] CACHE HIT q="${query.trim().substring(0, 20)}" cache=${cacheDuration}ms total=${Date.now() - totalStart}ms`);
      return NextResponse.json(cached);
    }

    const catalogResult = await searchCatalogDb(query, filters, page, limit, includeFacets, includeOems);

    if (catalogResult && catalogResult.products.length > 0) {
      const products: SearchResponseProduct[] = catalogResult.products.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        description: p.description,
        image_url: p.image_url,
        oem_numbers: p.oemNumbers,
        offers: [
          {
            supplierId: `db-${p.supplierName.toLowerCase().replace(/\s+/g, "-")}`,
            supplierName: p.supplierName,
            supplierSku: p.supplierSku,
            price: p.price,
            currency: p.currency,
            stockQuantity: p.stockQuantity,
            deliveryDays: null as number | null,
            isAvailable: p.stockQuantity > 0,
          } satisfies NormalizedOffer,
        ],
        dataSource: p.dataSource,
      }));

      let liveFallbackUsed = false;
      let liveErrors: { supplierId: string; supplierName: string; error: string }[] = [];

      if (isLiveFallbackEnabled()) {
        const liveResult = await searchProducts(query);
        liveFallbackUsed = true;
        liveErrors = liveResult.errors;

        for (const lp of liveResult.products) {
          const existing = products.find((np) => np.id === lp.id);
          if (existing) {
            const newOffers = lp.offers.filter(
              (lo) => !existing.offers.some((eo) => eo.supplierId === lo.supplierId),
            );
            existing.offers.push(...newOffers);
          } else {
            products.push({ ...lp, dataSource: "live-api" });
          }
        }
      }

      products.sort((a, b) => {
        const aMin = Math.min(...a.offers.map((o) => o.price), Infinity);
        const bMin = Math.min(...b.offers.map((o) => o.price), Infinity);
        return aMin - bMin;
      });

      const allSupplierCounts: Record<string, number> = { ...catalogResult.supplierCounts };
      for (const p of products) {
        for (const o of p.offers) {
          allSupplierCounts[o.supplierName] = (allSupplierCounts[o.supplierName] || 0) + 1;
        }
      }

      const response = {
        products,
        total: catalogResult.total,
        query,
        errors: liveFallbackUsed ? liveErrors : catalogResult.errors,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "existing-db" as const,
        supplierCounts: allSupplierCounts,
        brandCounts: catalogResult.brandCounts,
        appliedFilters: catalogResult.appliedFilters,
        liveFallbackUsed,
        page: catalogResult.page,
        limit: catalogResult.limit,
        hasMore: catalogResult.hasMore,
        resultCountShown: catalogResult.resultCountShown,
        totalEstimate: catalogResult.totalEstimate,
        timings: catalogResult.timings ? {
          ...catalogResult.timings,
          cache_duration_ms: cacheDuration,
          cacheHit: false,
        } : undefined,
      };

      setCachedSearchResult(cacheKey, response);

      return NextResponse.json(response);
    }

    if (catalogResult && catalogResult.products.length === 0 && isLiveFallbackEnabled()) {
      const liveResult = await searchProducts(query);
      return NextResponse.json({
        ...liveResult,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "live-api",
        liveFallbackUsed: true,
        page: 1,
        limit: 24,
        hasMore: liveResult.products.length > 24,
        resultCountShown: Math.min(liveResult.products.length, 24),
        totalEstimate: null,
      });
    }

    if (catalogResult && catalogResult.products.length === 0) {
      return NextResponse.json({
        products: [],
        total: 0,
        query,
        errors: catalogResult.errors,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "existing-db",
        supplierCounts: {},
        brandCounts: {},
        appliedFilters: filters,
        liveFallbackUsed: false,
        page: 1,
        limit,
        hasMore: false,
        resultCountShown: 0,
        totalEstimate: null,
      });
    }
  }

  const results = await searchProducts(query);
  return NextResponse.json({
    ...results,
    lastCheckedAt: new Date().toISOString(),
    dataSource: useExistingDb ? "existing-db" : "mock",
    page: 1,
    limit: 24,
    hasMore: false,
    resultCountShown: results.products.length,
    totalEstimate: results.total,
  });
}