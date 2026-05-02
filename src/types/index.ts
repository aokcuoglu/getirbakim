export interface Supplier {
  id: string;
  name: string;
  slug: string;
  api_base_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SupplierProduct {
  id: string;
  supplier_id: string;
  product_id: string | null;
  supplier_sku: string;
  supplier_name: string;
  supplier_brand: string | null;
  supplier_category: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
}

export interface ProductOffer {
  id: string;
  product_id: string;
  supplier_id: string;
  supplier_product_id: string;
  price: number;
  currency: string;
  stock_quantity: number;
  delivery_days: number | null;
  is_available: boolean;
  raw_price_response: Record<string, unknown> | null;
  checked_at: string;
  created_at: string;
}

export interface ProductOemNumber {
  id: string;
  product_id: string;
  oem_number: string;
  oem_brand: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface ProductRequest {
  id: string;
  product_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  vehicle_info: string | null;
  notes: string | null;
  status: "pending" | "contacted" | "quoted" | "closed" | "cancelled";
  kvkk_consent: boolean;
  kvkk_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierApiLog {
  id: string;
  supplier_id: string;
  endpoint: string;
  method: string;
  status_code: number | null;
  response_time_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface NormalizedProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  oem_numbers: string[];
  offers: NormalizedOffer[];
}

export interface NormalizedOffer {
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  price: number;
  currency: string;
  stockQuantity: number;
  deliveryDays: number | null;
  isAvailable: boolean;
}

export interface SearchResult {
  products: NormalizedProduct[];
  total: number;
  query: string;
  errors: SupplierSearchError[];
  lastCheckedAt?: string;
}

export interface SupplierSearchError {
  supplierId: string;
  supplierName: string;
  error: string;
}

export interface SupplierHealthStatus {
  supplierId: string;
  supplierName: string;
  isHealthy: boolean;
  lastChecked: string | null;
  responseTimeMs: number | null;
  lastError: string | null;
}