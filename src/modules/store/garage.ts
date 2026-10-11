import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
export const vehicleSchema = z.object({make:z.string().trim().min(2).max(40),model:z.string().trim().min(1).max(60),year:z.coerce.number().int().min(1900).max(new Date().getFullYear()+1),vehicleId:z.string().max(80).optional(),generation:z.string().max(100).optional(),fuel:z.string().max(30).optional(),engine:z.string().max(60).optional(),power:z.string().max(40).optional()});
export type GarageVehicle = z.infer<typeof vehicleSchema>;
export type GarageEntry = GarageVehicle & { key: string };
export function parseGarageVehicle(value: unknown): GarageVehicle | null {
 const parsed=vehicleSchema.safeParse(value);return parsed.success ? parsed.data : null;
}
export const garageVehicleLabel=(vehicle:GarageVehicle)=>[vehicle.make,vehicle.model,vehicle.engine,vehicle.year].filter(Boolean).join(" ");
/** The same vehicle selected twice is one garage entry: catalog type + model year, or the free-text fields. */
export function vehicleKey(vehicle: GarageVehicle) {
 return vehicle.vehicleId ? `type:${vehicle.vehicleId}:${vehicle.year}` : `text:${[vehicle.make,vehicle.model,vehicle.year].join("|").toLocaleLowerCase("tr")}`.slice(0,200);
}

const ACTIVE="gb_vehicle", GUEST_GARAGE="gb_garage";
// A cleared selection is remembered, so a signed-in account does not fall back to its latest saved vehicle.
const CLEARED="none";
export const GUEST_LIMIT=5, ACCOUNT_LIMIT=20;
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge:30*86400};
async function signedInAccount() {
 const {currentAccount}=await import("@/modules/auth/session");
 const account=await currentAccount();return account?.approved ? account : null;
}
async function guestGarage(): Promise<GarageVehicle[]> {
 try { return z.array(z.unknown()).parse(JSON.parse((await cookies()).get(GUEST_GARAGE)?.value ?? "[]")).flatMap(v=>parseGarageVehicle(v) ?? []); }
 catch { return []; }
}
async function accountGarage(accountId: string) {
 return (await db.query<{vehicle:unknown}>("SELECT vehicle FROM account_vehicles WHERE account_id=$1 ORDER BY selected_at DESC LIMIT $2",[accountId,ACCOUNT_LIMIT])).rows.flatMap(row=>parseGarageVehicle(row.vehicle) ?? []);
}

export async function currentVehicle() {
 const raw=(await cookies()).get(ACTIVE)?.value;
 if(raw===CLEARED) return null;
 try { const active=parseGarageVehicle(raw ? JSON.parse(raw) : null); if(active) return active; } catch {}
 const account=await signedInAccount();
 return account ? (await accountGarage(account.id))[0] ?? null : null;
}
/** Saved vehicles, most recently selected first. */
export async function savedVehicles(): Promise<{signedIn:boolean;vehicles:GarageEntry[]}> {
 const account=await signedInAccount();
 const vehicles=account ? await accountGarage(account.id) : await guestGarage();
 return {signedIn:Boolean(account),vehicles:vehicles.map(vehicle=>({...vehicle,key:vehicleKey(vehicle)}))};
}

/** Each vehicle becomes the account's most recently selected, in order; the list keeps the newest ACCOUNT_LIMIT. */
async function storeAccountVehicles(accountId: string, vehicles: GarageVehicle[]) {
 for(const vehicle of vehicles) await db.query(`INSERT INTO account_vehicles(account_id,vehicle_key,vehicle) VALUES($1,$2,$3)
  ON CONFLICT(account_id,vehicle_key) DO UPDATE SET vehicle=EXCLUDED.vehicle,selected_at=now()`,[accountId,vehicleKey(vehicle),JSON.stringify(vehicle)]);
 await db.query(`DELETE FROM account_vehicles WHERE account_id=$1 AND vehicle_key NOT IN
  (SELECT vehicle_key FROM account_vehicles WHERE account_id=$1 ORDER BY selected_at DESC LIMIT $2)`,[accountId,ACCOUNT_LIMIT]);
}

// Writes below set cookies, so they run only in Server Actions.
/** Makes the vehicle the active one and keeps it in the garage list. */
export async function chooseVehicle(vehicle: GarageVehicle) {
 const jar=await cookies();jar.set(ACTIVE,JSON.stringify(vehicle),cookieOptions);
 const account=await signedInAccount();
 if(account) await storeAccountVehicles(account.id,[vehicle]);
 else {
  const rest=(await guestGarage()).filter(v=>vehicleKey(v)!==vehicleKey(vehicle));
  jar.set(GUEST_GARAGE,JSON.stringify([vehicle,...rest].slice(0,GUEST_LIMIT)),cookieOptions);
 }
}
/** Removes a saved vehicle; removing the active one clears the selection. */
export async function forgetVehicle(key: string) {
 const jar=await cookies(),active=await currentVehicle();
 const account=await signedInAccount();
 if(account) await db.query("DELETE FROM account_vehicles WHERE account_id=$1 AND vehicle_key=$2",[account.id,key]);
 else jar.set(GUEST_GARAGE,JSON.stringify((await guestGarage()).filter(v=>vehicleKey(v)!==key)),cookieOptions);
 if(active && vehicleKey(active)===key) jar.set(ACTIVE,CLEARED,cookieOptions);
}
export async function clearActiveVehicle() { (await cookies()).set(ACTIVE,CLEARED,cookieOptions); }
/** On sign-in, the guest garage moves to the account; the active vehicle stays active. */
export async function adoptGuestGarage(accountId: string) {
 const jar=await cookies(),guest=await guestGarage();
 let active:GarageVehicle|null=null;
 try { active=parseGarageVehicle(JSON.parse(jar.get(ACTIVE)?.value ?? "null")); } catch {}
 // Oldest first, so the active vehicle ends up most recently selected.
 const vehicles=[...guest.reverse(),...(active ? [active] : [])];
 if(vehicles.length) await storeAccountVehicles(accountId,vehicles);
 jar.delete(GUEST_GARAGE);
}
