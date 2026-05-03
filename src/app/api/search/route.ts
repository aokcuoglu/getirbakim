import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/suppliers/search";
import { searchCatalogDb } from "@/lib/catalog-search";
import { isCatalogDbEnabled, getCatalogSearchSource, isLiveFallbackEnabled } from "@/lib/catalog-db";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { NormalizedProduct, NormalizedOffer } from "@/types";

interface SearchResponseProduct extends NormalizedProduct {
  dataSource?: string;
}

export async function GET(request: NextRequest) {
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
      }
    );
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({
      products: [],
      total: 0,
      query: "",
      errors: [],
      lastCheckedAt: new Date().toISOString(),
    });
  }

  const useExistingDb = isCatalogDbEnabled() && getCatalogSearchSource() === "existing-db";

  if (useExistingDb) {
    const catalogResult = await searchCatalogDb(query);

    if (catalogResult && catalogResult.total > 0) {
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
              (lo) => !existing.offers.some((eo) => eo.supplierId === lo.supplierId)
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

      return NextResponse.json({
        products,
        total: products.length,
        query,
        errors: liveFallbackUsed ? liveErrors : catalogResult.errors,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "existing-db",
        supplierCounts: allSupplierCounts,
        liveFallbackUsed,
      });
    }

    if (catalogResult && catalogResult.total === 0 && isLiveFallbackEnabled()) {
      const liveResult = await searchProducts(query);
      return NextResponse.json({
        ...liveResult,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "live-api",
        liveFallbackUsed: true,
      });
    }

    if (catalogResult && catalogResult.total === 0) {
      return NextResponse.json({
        products: [],
        total: 0,
        query,
        errors: catalogResult.errors,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "existing-db",
        supplierCounts: {},
        liveFallbackUsed: false,
      });
    }

    if (catalogResult && catalogResult.errors.length > 0 && isLiveFallbackEnabled()) {
      const liveResult = await searchProducts(query);
      return NextResponse.json({
        ...liveResult,
        lastCheckedAt: new Date().toISOString(),
        dataSource: "live-api",
        liveFallbackUsed: true,
      });
    }
  }

  const results = await searchProducts(query);
  return NextResponse.json({
    ...results,
    lastCheckedAt: new Date().toISOString(),
    dataSource: useExistingDb ? "existing-db" : "mock",
  });
}