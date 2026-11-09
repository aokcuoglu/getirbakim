import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import type { ProductPricing } from "./product-pricing-schema";
import { loadProductPricing } from "./product-pricing-store";

export async function adminProductPricing(id: string): Promise<ProductPricing> {
  await requireAdmin();
  return loadProductPricing(db, id);
}

