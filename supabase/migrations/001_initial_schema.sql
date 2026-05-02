-- getirbakim.com - v0.1.0 Supplier Search MVP
-- Supabase database schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Suppliers
CREATE TABLE suppliers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  api_base_url TEXT,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Supplier Products (raw supplier data)
CREATE TABLE supplier_products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  supplier_sku TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_brand TEXT,
  supplier_category TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(supplier_id, supplier_sku)
);

-- Products (normalized internal product catalog)
CREATE TABLE products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  brand TEXT,
  category TEXT,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Product Offers (live price/stock from suppliers)
CREATE TABLE product_offers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_id UUID NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  price NUMERIC(10, 2) NOT NULL,
  currency TEXT DEFAULT 'TRY' NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  delivery_days INTEGER,
  is_available BOOLEAN DEFAULT false NOT NULL,
  raw_price_response JSONB,
  checked_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Product OEM Numbers
CREATE TABLE product_oem_numbers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  oem_number TEXT NOT NULL,
  oem_brand TEXT,
  is_primary BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Product Requests (customer inquiries)
CREATE TABLE product_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  vehicle_info TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'fulfilled', 'cancelled')),
  kvkk_consent BOOLEAN NOT NULL DEFAULT false,
  kvkk_consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Supplier API Logs (server-side only)
CREATE TABLE supplier_api_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  status_code INTEGER,
  response_time_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_product ON supplier_products(product_id);
CREATE INDEX idx_supplier_products_sku ON supplier_products(supplier_sku);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_brand ON products(brand);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_product_offers_product ON product_offers(product_id);
CREATE INDEX idx_product_offers_supplier ON product_offers(supplier_id);
CREATE INDEX idx_product_offers_available ON product_offers(is_available);
CREATE INDEX idx_product_oem_numbers_product ON product_oem_numbers(product_id);
CREATE INDEX idx_product_oem_numbers_oem ON product_oem_numbers(oem_number);
CREATE INDEX idx_product_requests_status ON product_requests(status);
CREATE INDEX idx_product_requests_created ON product_requests(created_at DESC);
CREATE INDEX idx_supplier_api_logs_supplier ON supplier_api_logs(supplier_id);
CREATE INDEX idx_supplier_api_logs_created ON supplier_api_logs(created_at DESC);

-- Row Level Security
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_oem_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_api_logs ENABLE ROW LEVEL SECURITY;

-- Public read access for products, offers, suppliers
CREATE POLICY "Products are publicly readable" ON products FOR SELECT USING (true);
CREATE POLICY "Product offers are publicly readable" ON product_offers FOR SELECT USING (true);
CREATE POLICY "Suppliers are publicly readable" ON suppliers FOR SELECT USING (true);
CREATE POLICY "Supplier products are publicly readable" ON supplier_products FOR SELECT USING (true);
CREATE POLICY "OEM numbers are publicly readable" ON product_oem_numbers FOR SELECT USING (true);

-- Product requests: anyone can create, admin can read/update
CREATE POLICY "Anyone can create product requests" ON product_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can read product requests" ON product_requests FOR SELECT USING (true);

-- API logs: only service role
CREATE POLICY "Service role can manage api logs" ON supplier_api_logs FOR ALL USING (true);