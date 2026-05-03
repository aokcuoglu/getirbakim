import { NextResponse } from "next/server";
import { searchCatalogDb } from "@/lib/catalog-search";
import { isCatalogDbEnabled, getCatalogSearchSource } from "@/lib/catalog-db";
import type { NormalizedOffer } from "@/types";

export async function GET() {
  const useExistingDb = isCatalogDbEnabled() && getCatalogSearchSource() === "existing-db";

  if (!useExistingDb) {
    return NextResponse.json({ products: [], total: 0, dataSource: "mock" });
  }

  try {
    const result = await searchCatalogDb("", {
      sort: "in_stock_first",
      inStock: true,
    });

    if (!result || result.products.length === 0) {
      return NextResponse.json({ products: [], total: 0, dataSource: "existing-db" });
    }

    const products = result.products
      .filter((p) => p.price > 0 && p.brand)
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        description: p.description,
        image_url: p.image_url,
        oem_numbers: p.oemNumbers,
        offers: [
          {
            supplierId: `db-${p.supplierName.toLowerCase().replace(/\s+/g, "-")}`,
            supplierName: p.supplierName,
            supplierSku: p.supplierSku,
            price: p.price,
            currency: p.currency,
            stockQuantity: p.stockQuantity,
            deliveryDays: null as number | null,
            isAvailable: p.stockQuantity > 0,
          } satisfies NormalizedOffer,
        ],
        dataSource: p.dataSource,
      }));

    return NextResponse.json({
      products,
      total: products.length,
      dataSource: "existing-db",
    });
  } catch {
    return NextResponse.json({ products: [], total: 0, dataSource: "existing-db" });
  }
}