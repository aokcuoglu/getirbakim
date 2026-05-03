import { NextRequest, NextResponse } from "next/server";
import { getProductDetails } from "@/suppliers/search";
import { isCatalogDbEnabled, getCatalogSearchSource } from "@/lib/catalog-db";
import { getProviderNames, normalizeProviderName } from "@/lib/catalog-search";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  if (id.startsWith("db-")) {
    const dbId = parseInt(id.replace("db-", ""), 10);
    if (isNaN(dbId)) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const useDb = isCatalogDbEnabled() && getCatalogSearchSource() === "existing-db";
    if (!useDb) {
      return NextResponse.json({ error: "Catalog DB not available" }, { status: 404 });
    }

    try {
      const { getCatalogPool, getCatalogSchema, getCatalogTableName } = await import("@/lib/catalog-db");
      const pool = getCatalogPool();
      const schema = getCatalogSchema();
      const tableName = getCatalogTableName();

      const colCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [schema, tableName],
      );
      const columnNames = colCheck.rows.map((r: { column_name: string }) => r.column_name);

      const selectCols = [
        "id",
        "provider_id",
        "supplier_product_key",
        "supplier_sku",
        "supplier_brand",
        "supplier_name",
        "normalized_sku",
        "normalized_name",
        "barcode_1",
        "barcode_2",
        "barcode_3",
        "supplier_price",
        "supplier_stock_qty",
        "currency",
        "image_url",
        "updated_at",
        "last_seen_at",
        "created_at",
      ].filter(c => columnNames.includes(c));

      const prefixedCols = selectCols.map(c => `sp.${c}`);

      const result = await pool.query(
        `SELECT ${prefixedCols.join(", ")} FROM ${schema}.${tableName} sp WHERE sp.id = $1`,
        [dbId],
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: "Product not found in catalog" }, { status: 404 });
      }

      const row = result.rows[0];

      const providers = await getProviderNames(pool);

      const providersMap = providers as Map<number, string>;
      const providerName = normalizeProviderName(
        providersMap.get(row.provider_id) ?? `Provider ${row.provider_id}`
      );

      let oemNumbers: string[] = [];
      const oemResult = await pool.query(
        `SELECT oem_code FROM supplier_product_oems WHERE supplier_product_id = $1 AND is_active = true ORDER BY oem_code`,
        [dbId],
      );
      oemNumbers = oemResult.rows.map((r: { oem_code: string }) => r.oem_code);

      const snapshot = {
        supplier_product_id: row.id,
        supplier_name: providerName,
        supplier_sku: row.supplier_sku,
        product_name: row.supplier_name ?? row.supplier_sku,
        brand: row.supplier_brand,
        price: Number(row.supplier_price) || 0,
        currency: row.currency || "TRY",
        stock_quantity: row.supplier_stock_qty ?? 0,
        data_source: "existing-db",
        oem_numbers: oemNumbers,
      };

      return NextResponse.json({
        id: `db-${row.id}`,
        name: row.supplier_name ?? row.supplier_sku,
        brand: row.supplier_brand,
        category: null,
        description: null,
        image_url: row.image_url && row.image_url.trim() ? row.image_url.trim() : null,
        oem_numbers: oemNumbers,
        offers: [{
          supplierId: `db-${providerName.toLowerCase().replace(/\s+/g, "-")}`,
          supplierName: providerName,
          supplierSku: row.supplier_sku,
          price: Number(row.supplier_price) || 0,
          currency: row.currency || "TRY",
          stockQuantity: row.supplier_stock_qty ?? 0,
          deliveryDays: null,
          isAvailable: (row.supplier_stock_qty ?? 0) > 0,
        }],
        dataSource: "existing-db",
        snapshot,
        lastCheckedAt: row.updated_at ?? row.last_seen_at ?? row.created_at,
      });
    } catch {
      return NextResponse.json({ error: "Failed to fetch product from catalog" }, { status: 500 });
    }
  }

  const product = await getProductDetails(id);
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const snapshot = {
    supplier_product_id: null,
    supplier_name: product.offers[0]?.supplierName ?? null,
    supplier_sku: product.offers[0]?.supplierSku ?? null,
    product_name: product.name,
    brand: product.brand,
    price: product.offers[0]?.price ?? null,
    currency: product.offers[0]?.currency ?? "TRY",
    stock_quantity: product.offers[0]?.stockQuantity ?? null,
    data_source: "mock" as const,
    oem_numbers: product.oem_numbers,
  };

  return NextResponse.json({
    ...product,
    snapshot,
    lastCheckedAt: new Date().toISOString(),
  });
}