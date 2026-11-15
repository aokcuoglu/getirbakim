"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { vehicleSchema, chooseVehicle, forgetVehicle, savedVehicles, currentVehicle, vehicleKey } from "@/modules/store/garage";
import { savedCatalogVehicle } from "@/modules/store/vehicle-catalog.server";
import { garageFormChange } from "@/modules/store/garage-form";
import { shownVehicle } from "@/modules/store/vehicle-label";
import type { ShownVehicle } from "@/modules/store/vehicle-catalog";

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
export type ShownGarageEntry=ShownVehicle&{key:string};
/** The saved vehicles with their display labels (#689); each keeps its stored make and model and its key. */
export async function garageVehicles(): Promise<{signedIn:boolean;vehicles:ShownGarageEntry[];activeKey:string|null}> {
 const [saved,active]=await Promise.all([savedVehicles(),currentVehicle()]);
 return {...saved,vehicles:saved.vehicles.map(entry=>shownVehicle(entry)),activeKey:active ? vehicleKey(active) : null};
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
 const parsed=vehicleSchema.pick({make:true,model:true,year:true}).safeParse(Object.fromEntries(form));
 if(!parsed.success) redirect("/garaj?error=1");
 const before=await currentVehicle(),change=garageFormChange(parsed.data,before);
 if(change.kind==="catalog-year") {
  if((await selectCatalogVehicle(change.vehicleId,change.year)).error) redirect("/garaj?error=1");
 } else {
  const checked=vehicleSchema.safeParse(change.kind==="keep" ? change.vehicle : {make:change.make,model:change.model,year:change.year});
  if(!checked.success) redirect("/garaj?error=1");
  await chooseVehicle(checked.data);
 }
 // The form edits the current vehicle: an edited one replaces its old garage entry instead of staying beside it.
 const after=await currentVehicle();
 if(before&&after&&vehicleKey(before)!==vehicleKey(after)) await forgetVehicle(vehicleKey(before));
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
