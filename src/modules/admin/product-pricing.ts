import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import type { ProductPricing } from "./product-pricing-schema";

export async function adminProductPricing(id: string): Promise<ProductPricing> {
  await requireAdmin();
  const { rows } = await db.query<ProductPricing>(`SELECT p.markup_percent::float8 AS markup,p.vat_percent::float8 AS vat,
    s.markup_percent::float8 AS "generalMarkup",s.vat_percent::float8 AS "generalVat"
    FROM commerce_settings s LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=$1 WHERE s.id=true`, [id]);
  if (!rows[0]) throw new Error("Satış ayarları bulunamadı.");
  return rows[0];
}

