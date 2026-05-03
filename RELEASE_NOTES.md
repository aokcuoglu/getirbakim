# Release Notes — v0.3.2 Product Request & Sales Lead MVP

**Release Date:** 2026-05-03

## Overview

v0.3.2 adds a working product request / sales lead flow, converting product search traffic into customer requests. Product cards now feature "Teklif Al" (Get Quote) and "Uyumluluk Kontrolü" (Compatibility Check) CTAs that lead to a pre-filled request form with product snapshot. The request is stored in the existing `product_requests` table with full product context. Admin can view and manage requests with an enhanced status workflow.

## Highlights

- Added product-specific request flow with "Teklif Al" and "Uyumluluğu Kontrol Et" CTAs on product cards
- Stored customer product requests in the existing `product_requests` table with product snapshot
- Added product snapshot with supplier, SKU, price, stock, OEM, and data source information
- Added admin request management with enhanced status workflow (new → reviewing → contacted → quoted → converted → cancelled)
- Added request type field (quote vs compatibility check)
- Added DB-backed product detail API (`/api/products/[id]`) with snapshot generation
- Request form shows selected product summary with price, stock, brand, supplier, and SKU info
- Trust warnings: "Fiyat ve stok bilgisi talep öncesinde tekrar doğrulanır" and "Yanlış parça riskini azaltmak için talep sonrası uyumluluk teyidi yapılır"
- Homepage CTA updated: "Parça bulamadım / teklif iste" with both quote and compatibility links
- Search empty state links to request form with trust warning
- Phone field is now required on request form; email is optional
- WhatsApp/contact placeholder: "Telefon ile dönüş yapılacaktır · WhatsApp desteği yakında"
- Preserved DB-backed catalog search
- Preserved raw_json safety (never exposed to browser)
- Preserved admin authentication
- Preserved Docker local setup on http://localhost:3001

## New Status Workflow

| Status | Turkish | Description |
|--------|---------|-------------|
| `new` | Yeni | Fresh request, not yet reviewed |
| `reviewing` | İnceleniyor | Under review by team |
| `contacted` | İletişime Geçildi | Customer contacted |
| `quoted` | Teklif Verildi | Price quote sent |
| `converted` | Siparişe Dönüştü | Converted to order |
| `cancelled` | İptal Edildi | Request cancelled |

**Migration Note:** Status values have changed. Run `supabase/migrations/004_product_request_enhancements.sql` to add new columns and update the status constraint. Previous `pending` status maps to `new`.

## Schema Changes

### `product_requests` table

| Column | Type | Description |
|--------|------|-------------|
| `supplier_product_id` | INTEGER (nullable) | References catalog product ID |
| `product_snapshot` | JSONB (nullable) | Product info snapshot at request time |
| `request_type` | TEXT (default 'quote') | 'quote' or 'compatibility' |

### `product_snapshot` JSON structure

```json
{
  "supplier_product_id": 12345,
  "supplier_name": "Dinamik",
  "supplier_sku": "ANKA20100020",
  "product_name": "Fren Balatası",
  "brand": "Bosch",
  "price": 450.00,
  "currency": "TRY",
  "stock_quantity": 12,
  "data_source": "existing-db",
  "oem_numbers": ["BV6Z3504WT", "4100-1780"]
}
```

### Status constraint updated

`product_requests_status_check` now allows: `new`, `reviewing`, `contacted`, `quoted`, `converted`, `cancelled`

## Pages

| Route | Description |
|-------|-------------|
| `/request?supplierProductId=&type=quote` | Quote request form (pre-filled with product) |
| `/request?supplierProductId=&type=compatibility` | Compatibility check request form |
| `/request` | General request form (no product pre-selected) |
| `/admin/requests` | Admin request management with product snapshot and status workflow |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/requests` | POST | Create product request (public, KVKK required) |
| `/api/requests` | GET | List all requests (admin auth required) |
| `/api/requests/[id]` | GET | Get single request detail (admin auth required) |
| `/api/requests/[id]` | PATCH | Update request status (admin auth required) |
| `/api/products/[id]` | GET | Product detail with snapshot (supports `db-` prefix IDs) |

## Sales-Focused UI Changes

- **Product cards**: "Teklif Al" (primary) and "Uyumluluk" (secondary) CTAs
- **Product detail**: Sticky sidebar with "Teklif Al" and "Uyumluluğu Kontrol Et" links
- **Homepage CTA**: "Parça bulamadım / teklif iste" with quote and compatibility buttons
- **Search empty state**: "Parça Talep Et" button with trust warning
- **Request success page**: "Telefon ile dönüş yapılacaktır · WhatsApp desteği yakında"
- **Trust warning on request form**: "Yanlış parça riskini azaltmak için talep sonrası uyumluluk teyidi yapılır"

## Known Notes

- Payment/checkout is not implemented
- Cart is not implemented
- Price and stock are still re-verified manually before commercial order confirmation
- Vehicle fitment is not implemented
- VIN/chassis and plate search are not implemented
- Başbuğ import is not included
- WhatsApp integration is not yet connected (placeholder only)

## Migration from v0.3.1

1. Pull the latest code
2. Run `supabase/migrations/004_product_request_enhancements.sql` on your Supabase dashboard
3. Rebuild Docker: `docker compose build --no-cache && docker compose up -d`
4. Verify at `/admin/requests` — should see new status workflow
5. Test request flow at `/request?type=quote` with a product

---
