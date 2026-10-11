"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { vehicleSchema, chooseVehicle, forgetVehicle, savedVehicles, currentVehicle, vehicleKey, type GarageEntry } from "@/modules/store/garage";
import { savedCatalogVehicle } from "@/modules/store/vehicle-catalog.server";

export async function selectCatalogVehicle(vehicleId: string, year: number) {
 const vehicle=await savedCatalogVehicle(vehicleId,year);
 if(!vehicle) return {error:"Araç ve model yılını kontrol et."};
 const parsed=vehicleSchema.safeParse(vehicle);
 if(!parsed.success) return {error:"Araç bilgileri kaydedilemedi."};
 await chooseVehicle(parsed.data);
 return {success:true};
}
/** Removes the active vehicle from the garage. */
export async function clearCatalogVehicle() {
 const active=await currentVehicle();
 if(active) await forgetVehicle(vehicleKey(active));
}
export async function garageVehicles(): Promise<{signedIn:boolean;vehicles:GarageEntry[];activeKey:string|null}> {
 const [saved,active]=await Promise.all([savedVehicles(),currentVehicle()]);
 return {...saved,activeKey:active ? vehicleKey(active) : null};
}
const keySchema=z.string().min(1).max(200);
export async function switchGarageVehicle(key: string) {
 const vehicle=keySchema.safeParse(key).success ? (await savedVehicles()).vehicles.find(v=>v.key===key) : undefined;
 if(!vehicle) return {error:"Araç garajında bulunamadı."};
 const {key:_key,...rest}=vehicle;void _key;
 await chooseVehicle(rest);
 return {success:true};
}
export async function removeGarageVehicle(key: string) {
 if(!keySchema.safeParse(key).success) return {error:"Araç garajında bulunamadı."};
 await forgetVehicle(key);
 return {success:true};
}
export async function saveVehicle(form:FormData) {
 const parsed=vehicleSchema.safeParse(Object.fromEntries(form));
 if(!parsed.success) redirect("/garaj?error=1");
 await chooseVehicle(parsed.data);
 redirect("/garaj?saved=1");
}
export async function removeVehicle() { await clearCatalogVehicle();redirect("/garaj"); }
export async function switchVehicleForm(form:FormData) {
 const result=await switchGarageVehicle(String(form.get("key") ?? ""));
 redirect(result.error ? "/garaj?error=1" : "/garaj?saved=1");
}
export async function removeVehicleForm(form:FormData) {
 await removeGarageVehicle(String(form.get("key") ?? ""));redirect("/garaj");
}
