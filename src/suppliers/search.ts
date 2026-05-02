import type { SearchResult, NormalizedProduct, SupplierHealthStatus } from "@/types";
import { getAllAdapters } from "./index";
import { getSupplierMode } from "./config";
import { getCachedResult, setCachedResult } from "./cache";
import type { SupplierProductItem } from "./types";

function toItem(product: SupplierProductItem): NormalizedProduct {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
    image_url: product.imageUrl,
    oem_numbers: product.oemNumbers,
    offers: [...product.offers],
  };
}

export async function searchProducts(query: string): Promise<SearchResult> {
  const mode = getSupplierMode();
  const cached = getCachedResult<SearchResult>(query, mode);
  if (cached) return cached;

  const adapters = getAllAdapters();
  const results = await Promise.allSettled(
    adapters.map((adapter) => adapter.search(query))
  );

  const products: NormalizedProduct[] = [];
  const errors: SearchResult["errors"] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const adapter = adapters[i];

    if (result.status === "fulfilled") {
      const searchResult = result.value;
      if (searchResult.error) {
        errors.push({
          supplierId: adapter.supplierId,
          supplierName: adapter.supplierName,
          error: searchResult.error,
        });
      }
      for (const product of searchResult.products) {
        const existing = products.find((p) => p.id === product.id);
        if (existing) {
          existing.offers.push(...product.offers);
        } else {
          products.push(toItem(product));
        }
      }
    } else {
      errors.push({
        supplierId: adapter.supplierId,
        supplierName: adapter.supplierName,
        error: result.reason?.message ?? "Unknown error",
      });
    }
  }

  products.sort((a, b) => {
    const aMin = Math.min(...a.offers.map((o) => o.price), Infinity);
    const bMin = Math.min(...b.offers.map((o) => o.price), Infinity);
    return aMin - bMin;
  });

  const searchResult: SearchResult = {
    products,
    total: products.length,
    query,
    errors,
  };

  if (errors.length === 0) {
    setCachedResult(query, mode, searchResult);
  }

  return searchResult;
}

export async function getProductDetails(
  productId: string
): Promise<NormalizedProduct | null> {
  const adapters = getAllAdapters();
  let found: NormalizedProduct | null = null;

  for (const adapter of adapters) {
    try {
      const result = await adapter.getProduct(productId);
      if (result) {
        found = toItem(result);
        break;
      }
    } catch {
      continue;
    }
  }

  return found;
}

export async function checkAllSupplierHealth(): Promise<SupplierHealthStatus[]> {
  const adapters = getAllAdapters();
  const results = await Promise.allSettled(
    adapters.map((adapter) => adapter.checkHealth())
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      supplierId: adapters[i].supplierId,
      supplierName: adapters[i].supplierName,
      isHealthy: false,
      lastChecked: new Date().toISOString(),
      responseTimeMs: null,
      lastError: result.reason?.message ?? "Health check failed",
    };
  });
}