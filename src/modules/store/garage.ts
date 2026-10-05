import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
export const vehicleSchema = z.object({make:z.string().trim().min(2).max(40),model:z.string().trim().min(1).max(60),year:z.coerce.number().int().min(1900).max(new Date().getFullYear()+1),vehicleId:z.string().max(80).optional(),generation:z.string().max(100).optional(),fuel:z.string().max(30).optional(),engine:z.string().max(60).optional(),power:z.string().max(40).optional()});
export async function currentVehicle() {
 const raw=(await cookies()).get("gb_vehicle")?.value;
 try { const parsed=vehicleSchema.safeParse(raw ? JSON.parse(raw) : null);return parsed.success ? parsed.data : null; } catch { return null; }
}
