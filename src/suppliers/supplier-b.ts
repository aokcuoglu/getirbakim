import type { SupplierHealthStatus } from "@/types";
import type { SupplierAdapter, SupplierSearchResult, SupplierProductItem } from "./types";
import { logSupplierCall } from "./logger";

export class SupplierBAdapter implements SupplierAdapter {
  readonly supplierId = "supplier-b";
  readonly supplierName = "Tedarikçi B";
  readonly supplierSlug = "supplier-b";
  readonly apiKey = process.env.SUPPLIER_B_API_KEY ?? "";
  readonly baseUrl = process.env.SUPPLIER_B_BASE_URL ?? "";

  async search(query: string): Promise<SupplierSearchResult> {
    if (!this.apiKey || !this.baseUrl) {
      return { products: [], error: "Supplier B API credentials not configured" };
    }

    const start = Date.now();
    try {
      const res = await fetch(
        `${this.baseUrl}/v2/search?keyword=${encodeURIComponent(query)}`,
        {
          headers: {
            "X-API-Key": this.apiKey,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10000),
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
        return { products: [], error: `Supplier B returned ${res.status}` };
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
        products: (data.results ?? []).map((item: Record<string, unknown>) =>
          this.normalizeProduct(item)
        ),
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Supplier B search failed";
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
    if (!this.apiKey || !this.baseUrl) return null;

    try {
      const id = productId.replace("sB-", "");
      const res = await fetch(`${this.baseUrl}/v2/products/${id}`, {
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return this.normalizeProduct(data);
    } catch {
      return null;
    }
  }

  async checkHealth(): Promise<SupplierHealthStatus> {
    if (!this.apiKey || !this.baseUrl) {
      return {
        supplierId: this.supplierId,
        supplierName: this.supplierName,
        isHealthy: false,
        lastChecked: new Date().toISOString(),
        responseTimeMs: null,
        lastError: "API credentials not configured",
      };
    }

    try {
      const start = Date.now();
      const res = await fetch(`${this.baseUrl}/v2/health`, {
        headers: { "X-API-Key": this.apiKey },
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
      id: `sB-${raw.productId as string}`,
      name: (raw.productName as string) ?? "",
      brand: (raw.brandName as string) ?? null,
      category: (raw.category as string) ?? null,
      description: (raw.details as string) ?? null,
      imageUrl: (raw.imageUrl as string) ?? null,
      oemNumbers: Array.isArray(raw.oemCodes)
        ? (raw.oemCodes as string[])
        : [],
      offers: Array.isArray(raw.pricing)
        ? (raw.pricing as Record<string, unknown>[]).map((p) => ({
            supplierId: this.supplierId,
            supplierName: this.supplierName,
            supplierSku: (p.skuCode as string) ?? "",
            price: (p.unitPrice as number) ?? 0,
            currency: (p.currency as string) ?? "TRY",
            stockQuantity: (p.availableQty as number) ?? 0,
            deliveryDays: (p.estimatedDeliveryDays as number) ?? null,
            isAvailable: (p.inStock as boolean) ?? false,
          }))
        : [],
    };
  }
}