import type { SupplierHealthStatus } from "@/types";
import type { SupplierAdapter, SupplierSearchResult, SupplierProductItem } from "./types";
import { isSupplierAEnabled, getSupplierATimeoutMs } from "./config";
import { logSupplierCall } from "./logger";

export class SupplierAAdapter implements SupplierAdapter {
  readonly supplierId = "supplier-a";
  readonly supplierName = "Tedarikçi A";
  readonly supplierSlug = "supplier-a";
  readonly apiKey = process.env.SUPPLIER_A_API_KEY ?? "";
  readonly baseUrl = process.env.SUPPLIER_A_BASE_URL ?? "";

  private get timeoutMs(): number {
    return getSupplierATimeoutMs();
  }

  async search(query: string): Promise<SupplierSearchResult> {
    if (!this.apiKey || !this.baseUrl || !isSupplierAEnabled()) {
      return { products: [], error: "Supplier A not enabled or API credentials not configured" };
    }

    const start = Date.now();
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/products/search?q=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(this.timeoutMs),
        }
      );

      const durationMs = Date.now() - start;

      if (!res.ok) {
        void logSupplierCall({
          supplierId: this.supplierId,
          supplierName: this.supplierName,
          operation: "search",
          success: false,
          durationMs,
          statusCode: res.status,
          error: `HTTP ${res.status}`,
        });
        return { products: [], error: `Supplier A returned ${res.status}` };
      }

      const data = await res.json();

      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "search",
        success: true,
        durationMs,
        statusCode: res.status,
      });

      return {
        products: (data.items ?? []).map((item: Record<string, unknown>) =>
          this.normalizeProduct(item)
        ),
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Supplier A search failed";
      void logSupplierCall({
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        operation: "search",
        success: false,
        durationMs,
        error: errorMsg,
      });
      return { products: [], error: errorMsg };
    }
  }

  async getProduct(productId: string): Promise<SupplierProductItem | null> {
    if (!this.apiKey || !this.baseUrl || !isSupplierAEnabled()) return null;

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/products/${productId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return this.normalizeProduct(data);
    } catch {
      return null;
    }
  }

  async checkHealth(): Promise<SupplierHealthStatus> {
    if (!this.apiKey || !this.baseUrl || !isSupplierAEnabled()) {
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
      const res = await fetch(`${this.baseUrl}/api/v1/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
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

  private normalizeProduct(raw: Record<string, unknown>): SupplierProductItem {
    return {
      id: `sA-${raw.id as string}`,
      name: (raw.name as string) ?? "",
      brand: (raw.brand as string) ?? null,
      category: (raw.category as string) ?? null,
      description: (raw.description as string) ?? null,
      imageUrl: (raw.image_url as string) ?? null,
      oemNumbers: Array.isArray(raw.oem_numbers)
        ? (raw.oem_numbers as string[])
        : [],
      offers: Array.isArray(raw.offers)
        ? (raw.offers as Record<string, unknown>[]).map((o) => ({
            supplierId: this.supplierId,
            supplierName: this.supplierName,
            supplierSku: (o.sku as string) ?? "",
            price: (o.price as number) ?? 0,
            currency: (o.currency as string) ?? "TRY",
            stockQuantity: (o.stock as number) ?? 0,
            deliveryDays: (o.delivery_days as number) ?? null,
            isAvailable: (o.available as boolean) ?? false,
          }))
        : [],
    };
  }
}