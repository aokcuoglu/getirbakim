export type Database = {
  public: {
    Tables: {
      suppliers: {
        Row: {
          id: string;
          name: string;
          slug: string;
          api_base_url: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          api_base_url?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          api_base_url?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
      };
      supplier_products: {
        Row: {
          id: number;
          provider_id: number;
          supplier_product_key: string;
          supplier_sku: string;
          supplier_brand: string | null;
          supplier_name: string | null;
          normalized_sku: string | null;
          normalized_name: string | null;
          barcode_1: string | null;
          barcode_2: string | null;
          barcode_3: string | null;
          supplier_price: number | null;
          supplier_stock_qty: number;
          currency: string;
          raw_json: Record<string, unknown>;
          image_url: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          provider_id: number;
          supplier_product_key: string;
          supplier_sku: string;
          supplier_brand?: string | null;
          supplier_name?: string | null;
          normalized_sku?: string | null;
          normalized_name?: string | null;
          barcode_1?: string | null;
          barcode_2?: string | null;
          barcode_3?: string | null;
          supplier_price?: number | null;
          supplier_stock_qty?: number;
          currency?: string;
          raw_json?: Record<string, unknown>;
          image_url?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          provider_id?: number;
          supplier_product_key?: string;
          supplier_sku?: string;
          supplier_brand?: string | null;
          supplier_name?: string | null;
          normalized_sku?: string | null;
          normalized_name?: string | null;
          barcode_1?: string | null;
          barcode_2?: string | null;
          barcode_3?: string | null;
          supplier_price?: number | null;
          supplier_stock_qty?: number;
          currency?: string;
          raw_json?: Record<string, unknown>;
          image_url?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      products: {
        Row: {
          id: string;
          name: string;
          slug: string;
          brand: string | null;
          category: string | null;
          description: string | null;
          image_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          brand?: string | null;
          category?: string | null;
          description?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          brand?: string | null;
          category?: string | null;
          description?: string | null;
          image_url?: string | null;
          created_at?: string;
        };
      };
      product_offers: {
        Row: {
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
        };
        Insert: {
          id?: string;
          product_id: string;
          supplier_id: string;
          supplier_product_id: string;
          price: number;
          currency?: string;
          stock_quantity: number;
          delivery_days?: number | null;
          is_available?: boolean;
          raw_price_response?: Record<string, unknown> | null;
          checked_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          supplier_id?: string;
          supplier_product_id?: string;
          price?: number;
          currency?: string;
          stock_quantity?: number;
          delivery_days?: number | null;
          is_available?: boolean;
          raw_price_response?: Record<string, unknown> | null;
          checked_at?: string;
          created_at?: string;
        };
      };
      product_oem_numbers: {
        Row: {
          id: string;
          product_id: string;
          oem_number: string;
          oem_brand: string | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          oem_number: string;
          oem_brand?: string | null;
          is_primary?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          oem_number?: string;
          oem_brand?: string | null;
          is_primary?: boolean;
          created_at?: string;
        };
      };
      product_requests: {
        Row: {
          id: string;
          product_id: string | null;
          supplier_product_id: number | null;
          product_snapshot: Record<string, unknown> | null;
          request_type: string;
          customer_name: string;
          customer_email: string;
          customer_phone: string | null;
          vehicle_info: string | null;
          notes: string | null;
          status: string;
          kvkk_consent: boolean;
          kvkk_consent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          supplier_product_id?: number | null;
          product_snapshot?: Record<string, unknown> | null;
          request_type?: string;
          customer_name: string;
          customer_email: string;
          customer_phone?: string | null;
          vehicle_info?: string | null;
          notes?: string | null;
          status?: string;
          kvkk_consent?: boolean;
          kvkk_consent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          supplier_product_id?: number | null;
          product_snapshot?: Record<string, unknown> | null;
          request_type?: string;
          customer_name?: string;
          customer_email?: string;
          customer_phone?: string | null;
          vehicle_info?: string | null;
          notes?: string | null;
          status?: string;
          kvkk_consent?: boolean;
          kvkk_consent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      supplier_api_logs: {
        Row: {
          id: string;
          supplier_id: string;
          endpoint: string;
          method: string;
          status_code: number | null;
          response_time_ms: number | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          supplier_id: string;
          endpoint: string;
          method: string;
          status_code?: number | null;
          response_time_ms?: number | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          supplier_id?: string;
          endpoint?: string;
          method?: string;
          status_code?: number | null;
          response_time_ms?: number | null;
          error_message?: string | null;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};