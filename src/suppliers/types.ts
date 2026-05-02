import type { NormalizedOffer, SupplierHealthStatus } from "@/types";

export interface SupplierProductItem {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  oemNumbers: string[];
  offers: NormalizedOffer[];
}

export interface SupplierSearchResult {
  products: SupplierProductItem[];
  error?: string;
}

export interface SupplierAdapter {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierSlug: string;
  readonly apiKey: string;
  readonly baseUrl: string;

  search(query: string): Promise<SupplierSearchResult>;
  getProduct(productId: string): Promise<SupplierProductItem | null>;
  checkHealth(): Promise<SupplierHealthStatus>;
}