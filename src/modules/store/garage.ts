import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
export const vehicleSchema = z.object({make:z.string().trim().min(2).max(40),model:z.string().trim().min(1).max(60),year:z.coerce.number().int().min(1900).max(new Date().getFullYear()+1),vehicleId:z.string().max(80).optional(),generation:z.string().max(100).optional(),fuel:z.string().max(30).optional(),engine:z.string().max(60).optional(),power:z.string().max(40).optional()});
export type GarageVehicle = z.infer<typeof vehicleSchema>;
export function parseGarageVehicle(value: unknown): GarageVehicle | null {
 const parsed=vehicleSchema.safeParse(value);return parsed.success ? parsed.data : null;
}
export async function currentVehicle() {
 const raw=(await cookies()).get("gb_vehicle")?.value;
 try { return parseGarageVehicle(raw ? JSON.parse(raw) : null); } catch { return null; }
}
export const garageVehicleLabel=(vehicle:GarageVehicle)=>[vehicle.make,vehicle.model,vehicle.engine,vehicle.year].filter(Boolean).join(" ");
