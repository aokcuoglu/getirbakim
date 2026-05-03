import type { SupplierHealthStatus } from "@/types";
import type { SupplierAdapter, SupplierSearchResult, SupplierProductItem } from "./types";
import { isSupplierAEnabled, getSupplierATimeoutMs, isSupplierAProxyEnabled, getSupplierAProxyUrl } from "./config";
import { logSupplierCall } from "./logger";
import {
  normalizeSupplierAProduct,
  normalizeSupplierAPrice,
  normalizeSupplierAStock,
  normalizeOemNumbers,
  normalizeCurrency,
  normalizeAvailability,
} from "./supplier-a-mappers";
import type { DinamikStockItem, DinamikPriceItem } from "./supplier-a-mappers";
import { ProxyAgent } from "undici";

export class SupplierAAdapter implements SupplierAdapter {
  readonly supplierId = "supplier-a";
  readonly supplierName = "Tedarikçi A";
  readonly supplierSlug = "supplier-a";
  readonly apiKey = process.env.SUPPLIER_A_API_KEY ?? "";
  readonly baseUrl = process.env.SUPPLIER_A_BASE_URL ?? "";

  private get secretKey(): string {
    return process.env.SUPPLIER_A_SECRET_KEY ?? "";
  }

  private get timeoutMs(): number {
    return getSupplierATimeoutMs();
  }

  private get proxyUsed(): boolean {
    return isSupplierAProxyEnabled() && !!getSupplierAProxyUrl();
  }

  private get dispatcher(): ProxyAgent | undefined {
    if (!isSupplierAProxyEnabled()) return undefined;
    const proxyUrl = getSupplierAProxyUrl();
    if (!proxyUrl) return undefined;
    return new ProxyAgent(proxyUrl);
  }

  private get isConfigured(): boolean {
    return !!(this.apiKey && this.secretKey && this.baseUrl && isSupplierAEnabled());
  }

  private authHeaders(): Record<string, string> {
    return {
      ApiKey: this.apiKey,
      SecretKey: this.secretKey,
    };
  }

  async search(query: string): Promise<SupplierSearchResult> {
    if (!this.isConfigured) {
      return { products: [], error: "Supplier A not enabled or API credentials not configured" };
    }

    const trimmed = query.trim();
    if (!trimmed) return { products: [] };

    const products = new Map<string, SupplierProductItem>();

    const [stockResult, stockListResult] = await Promise.allSettled([
      this.searchByStockCode(trimmed),
      this.searchByBrand(trimmed),
    ]);

    if (stockResult.status === "fulfilled" && stockResult.value) {
      products.set(stockResult.value.id, stockResult.value);
    }

    if (stockListResult.status === "fulfilled" && stockListResult.value) {
      for (const product of stockListResult.value) {
        if (!products.has(product.id)) {
          products.set(product.id, product);
        }
      }
    }

    if (products.size === 0) {
      const errors: string[] = [];
      if (stockResult.status === "rejected") errors.push(stockResult.reason?.message ?? "Stock lookup failed");
      if (stockListResult.status === "rejected") errors.push(stockListResult.reason?.message ?? "Brand search failed");
      return { products: [], error: errors.length ? errors.join("; ") : undefined };
    }

    const brandMatch = stockListResult.status === "fulfilled" && stockListResult.value?.length
      ? stockListResult.value[0]?.brand
      : null;

    if (brandMatch) {
      await this.enrichWithPrices(Array.from(products.values()), brandMatch);
    }

    return { products: Array.from(products.values()) };
  }

  async getProduct(productId: string): Promise<SupplierProductItem | null> {
    if (!this.isConfigured) return null;

    const code = productId.replace(/^sA-/, "");
    const start = Date.now();

    try {
      const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ STOK_KODU: code }),
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (this.dispatcher) fetchOptions.dispatcher = this.dispatcher;

      const res = await fetch(`${this.baseUrl}/api/Dnmk_Customer/getStock`, fetchOptions);

      const durationMs = Date.now() - start;

      if (!res.ok) {
        void logSupplierCall({
          supplierId: this.supplierId,
          supplierName: this.supplierName,
          operation: "getProduct",
          success: false,
          durationMs,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
          proxyUsed: this.proxyUsed,
        });
        return null;
      }

      const data = await res.json();

      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "getProduct",
        success: true,
        durationMs,
        statusCode: res.status,
        proxyUsed: this.proxyUsed,
      });

      const item = this.parseSingleStockResponse(data);
      if (!item) return null;

      return this.buildProductItem(item);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Supplier A getProduct failed";
      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "getProduct",
        success: false,
        durationMs,
        error: errorMsg,
        proxyUsed: this.proxyUsed,
      });
      return null;
    }
  }

  async checkHealth(): Promise<SupplierHealthStatus> {
    if (!this.isConfigured) {
      return {
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        isHealthy: false,
        lastChecked: new Date().toISOString(),
        responseTimeMs: null,
        lastError: "Not enabled or API credentials not configured",
      };
    }

    try {
      const start = Date.now();
      const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      };
      if (this.dispatcher) fetchOptions.dispatcher = this.dispatcher;

      const res = await fetch(`${this.baseUrl}/api/Dnmk_Customer/getBrandList`, fetchOptions);
      const responseTime = Date.now() - start;

      return {
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        isHealthy: res.ok,
        lastChecked: new Date().toISOString(),
        responseTimeMs: responseTime,
        lastError: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        isHealthy: false,
        lastChecked: new Date().toISOString(),
        responseTimeMs: null,
        lastError: err instanceof Error ? err.message : "Health check failed",
      };
    }
  }

  private async searchByStockCode(query: string): Promise<SupplierProductItem | null> {
    const start = Date.now();
    try {
      const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ STOK_KODU: query }),
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (this.dispatcher) fetchOptions.dispatcher = this.dispatcher;

      const res = await fetch(`${this.baseUrl}/api/Dnmk_Customer/getStock`, fetchOptions);

      const durationMs = Date.now() - start;

      if (!res.ok) {
        void logSupplierCall({
          supplierId: this.supplierId,
          supplierName: this.supplierName,
          operation: "searchByStockCode",
          success: false,
          durationMs,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
          proxyUsed: this.proxyUsed,
        });
        return null;
      }

      const data = await res.json();

      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "searchByStockCode",
        success: true,
        durationMs,
        statusCode: res.status,
        proxyUsed: this.proxyUsed,
      });

      const item = this.parseSingleStockResponse(data);
      if (!item) return null;

      return this.buildProductItem(item);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Stock code lookup failed";
      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "searchByStockCode",
        success: false,
        durationMs,
        error: errorMsg,
        proxyUsed: this.proxyUsed,
      });
      return null;
    }
  }

  private async searchByBrand(query: string): Promise<SupplierProductItem[]> {
    const start = Date.now();
    try {
      const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (this.dispatcher) fetchOptions.dispatcher = this.dispatcher;

      const res = await fetch(
        `${this.baseUrl}/api/Dnmk_Customer/getStockList/${encodeURIComponent(query)}`,
        fetchOptions
      );

      const durationMs = Date.now() - start;

      if (!res.ok) {
        void logSupplierCall({
          supplierId: this.supplierId,
          supplierName: this.supplierName,
          operation: "searchByBrand",
          success: false,
          durationMs,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
          proxyUsed: this.proxyUsed,
        });
        return [];
      }

      const data = await res.json();

      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "searchByBrand",
        success: true,
        durationMs,
        statusCode: res.status,
        proxyUsed: this.proxyUsed,
      });

      const items = this.parseStockListResponse(data);
      return items.map((item) => this.buildProductItem(item));
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Brand search failed";
      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "searchByBrand",
        success: false,
        durationMs,
        error: errorMsg,
        proxyUsed: this.proxyUsed,
      });
      return [];
    }
  }

  private async enrichWithPrices(
    products: SupplierProductItem[],
    brand: string
  ): Promise<void> {
    const start = Date.now();
    try {
      const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (this.dispatcher) fetchOptions.dispatcher = this.dispatcher;

      const res = await fetch(
        `${this.baseUrl}/api/Dnmk_Customer/getPriceList/${encodeURIComponent(brand)}`,
        fetchOptions
      );

      const durationMs = Date.now() - start;

      if (!res.ok) {
        void logSupplierCall({
          supplierId: this.supplierId,
          supplierName: this.supplierName,
          operation: "enrichPrices",
          success: false,
          durationMs,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
          proxyUsed: this.proxyUsed,
        });
        return;
      }

      const data = await res.json();

      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "enrichPrices",
        success: true,
        durationMs,
        statusCode: res.status,
        proxyUsed: this.proxyUsed,
      });

      const priceMap = this.parsePriceListResponse(data);

      for (const product of products) {
        const offer = product.offers[0];
        if (offer) {
          const price = priceMap.get(offer.supplierSku);
          if (price) {
            offer.price = price.fiyat ?? offer.price;
            offer.currency = price.doviz ?? offer.currency;
          }
        } else {
          const stockCode = product.id.replace("sA-", "");
          const priceEntry = priceMap.get(stockCode);
          if (priceEntry) {
            product.offers = [{
              supplierId: this.supplierId,
              supplierName: this.supplierName,
              supplierSku: stockCode,
              price: priceEntry.fiyat ?? 0,
              currency: priceEntry.doviz ?? "TRY",
              stockQuantity: 0,
              deliveryDays: null,
              isAvailable: false,
            }];
          }
        }
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Price enrichment failed";
      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "enrichPrices",
        success: false,
        durationMs,
        error: errorMsg,
        proxyUsed: this.proxyUsed,
      });
    }
  }

  private parseSingleStockResponse(data: unknown): DinamikStockItem | null {
    if (!data || typeof data !== "object") return null;
    const item = data as DinamikStockItem;
    if (!item.stokKodu) return null;
    return item;
  }

  private parseStockListResponse(data: unknown): DinamikStockItem[] {
    if (Array.isArray(data)) return data.filter((item) => item && typeof item === "object" && (item as DinamikStockItem).stokKodu);
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const key of ["data", "result", "items", "stockList", "Result", "Data"]) {
        if (Array.isArray(obj[key])) {
          return (obj[key] as unknown[]).filter((item) => item && typeof item === "object" && (item as DinamikStockItem).stokKodu) as DinamikStockItem[];
        }
      }
    }
    return [];
  }

  private parsePriceListResponse(data: unknown): Map<string, { fiyat: number; doviz: string }> {
    const map = new Map<string, { fiyat: number; doviz: string }>();
    let items: unknown[] = [];

    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const key of ["data", "result", "items", "priceList", "Result", "Data"]) {
        if (Array.isArray(obj[key])) {
          items = obj[key] as unknown[];
          break;
        }
      }
    }

    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as DinamikPriceItem;
      const code = item.stokKodu;
      if (!code) continue;
      map.set(code, {
        fiyat: normalizeSupplierAPrice(item),
        doviz: normalizeCurrency(),
      });
    }

    return map;
  }

  private buildProductItem(item: DinamikStockItem): SupplierProductItem {
    const sku = item.stokKodu ?? "";
    const stockQty = normalizeSupplierAStock(item);
    const price = normalizeSupplierAPrice(item);
    const currency = normalizeCurrency();

    return {
      id: `sA-${sku}`,
      name: normalizeSupplierAProduct(item),
      brand: item.marka ?? null,
      category: item.kull7s ?? null,
      description: item.kull8s ?? null,
      imageUrl: (item.resimUrl && item.resimUrl.trim()) ? item.resimUrl.trim() : null,
      oemNumbers: normalizeOemNumbers(item),
      offers: [{
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        supplierSku: sku,
        price,
        currency,
        stockQuantity: stockQty,
        deliveryDays: null,
        isAvailable: normalizeAvailability(stockQty),
      }],
    };
  }
}