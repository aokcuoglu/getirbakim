import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";

export type SupplierCheckoutMode = "live" | "snapshot";

export async function supplierCheckoutMode(connection: Pick<PoolClient, "query"> = db): Promise<SupplierCheckoutMode> {
  const { rows } = await connection.query<{ basbug_checkout_mode: SupplierCheckoutMode }>(
    "SELECT basbug_checkout_mode FROM commerce_settings WHERE id=true",
  );
  return rows[0]?.basbug_checkout_mode ?? "live";
}
