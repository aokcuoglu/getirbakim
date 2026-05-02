import type { SupplierHealthStatus } from "@/types";
import type { SupplierAdapter, SupplierSearchResult, SupplierProductItem } from "./types";
import { logSupplierCall } from "./logger";

export class SupplierCAdapter implements SupplierAdapter {
  readonly supplierId = "supplier-c";
  readonly supplierName = "Tedarikçi C";
  readonly supplierSlug = "supplier-c";
  readonly apiKey = process.env.SUPPLIER_C_API_KEY ?? "";
  readonly baseUrl = process.env.SUPPLIER_C_BASE_URL ?? "";

  async search(query: string): Promise<SupplierSearchResult> {
    if (!this.apiKey || !this.baseUrl) {
      return { products: [], error: "Supplier C API credentials not configured" };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${this.apiKey}`,
        },
        body: JSON.stringify({ query, limit: 50 }),
        signal: AbortSignal.timeout(10000),
      });

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
        return { products: [], error: `Supplier C returned ${res.status}` };
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
        products: (data.data ?? []).map((item: Record<string, unknown>) =>
          this.normalizeProduct(item)
        ),
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : "Supplier C search failed";
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
      const id = productId.replace("sC-", "");
      const res = await fetch(`${this.baseUrl}/api/products/${id}`, {
        method: "GET",
        headers: { Authorization: `Token ${this.apiKey}` },
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
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: { Authorization: `Token ${this.apiKey}` },
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
      id: `sC-${raw.partId as string}`,
      name: (raw.partName as string) ?? "",
      brand: (raw.manufacturer as string) ?? null,
      category: (raw.section as string) ?? null,
      description: (raw.longDescription as string) ?? null,
      imageUrl: (raw.thumbnailUrl as string) ?? null,
      oemNumbers: Array.isArray(raw.compatibility)
        ? (raw.compatibility as string[])
        : [],
      offers: Array.isArray(raw.stock)
        ? (raw.stock as Record<string, unknown>[]).map((s) => ({
            supplierId: this.supplierId,
            supplierName: this.supplierName,
            supplierSku: (s.warehouseRef as string) ?? "",
            price: (s.sellPrice as number) ?? 0,
            currency: (s.currencyCode as string) ?? "TRY",
            stockQuantity: (s.qty as number) ?? 0,
            deliveryDays: (s.shipDays as number) ?? null,
            isAvailable: (s.qty as number) > 0,
          }))
        : [],
    };
  }
}