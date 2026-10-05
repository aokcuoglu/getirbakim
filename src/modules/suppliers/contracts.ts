import "server-only";
import { z } from "zod";
// Internal normalized contract. Supplier wire schemas must be verified before adapting them.
export const supplierProductSchema = z.object({
 supplier: z.enum(["dinamik", "basbug"]), code: z.string().min(1).max(120),
 name: z.string().min(1), brand: z.string().min(1), description: z.string(),
 priceKurus: z.number().int().positive(), stock: z.number().int().nonnegative(),
});
export type SupplierProduct = z.infer<typeof supplierProductSchema>;
export type SupplierStatus = { name: string; configured: boolean; verified: boolean; message: string };
