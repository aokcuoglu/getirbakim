"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { vehicleSchema } from "@/modules/store/garage";
import { savedCatalogVehicle } from "@/modules/store/vehicle-catalog.server";

export async function selectCatalogVehicle(vehicleId: string, year: number) {
 const vehicle=await savedCatalogVehicle(vehicleId,year);
 if(!vehicle) return {error:"Araç ve model yılını kontrol et."};
 const parsed=vehicleSchema.safeParse(vehicle);
 if(!parsed.success) return {error:"Araç bilgileri kaydedilemedi."};
 (await cookies()).set("gb_vehicle",JSON.stringify(parsed.data),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*86400});
 return {success:true};
}
export async function clearCatalogVehicle() { (await cookies()).delete("gb_vehicle"); }
export async function saveVehicle(form:FormData) {
 const parsed=vehicleSchema.safeParse(Object.fromEntries(form));
 if(!parsed.success) redirect("/garaj?error=1");
 (await cookies()).set("gb_vehicle",JSON.stringify(parsed.data),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*86400});
 redirect("/garaj?saved=1");
}
export async function removeVehicle() { (await cookies()).delete("gb_vehicle");redirect("/garaj"); }
