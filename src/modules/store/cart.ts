import "server-only";
import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
const tokenHash = (token:string) => createHash("sha256").update(token).digest("hex");
import { db } from "@/lib/db";
import type { PoolClient } from "pg";
import { catalogSql, type CatalogProduct } from "./catalog";
import type { GarageVehicle } from "./garage";
export type CartOwner = { kind: "account" | "guest"; id: string };
export type CartItem = CatalogProduct & { quantity: number; vehicle: GarageVehicle | null };
export async function cartQuantity(owner: CartOwner | null): Promise<number> {
 if (!owner) return 0;
 const {rows} = await db.query<{quantity: string}>(
  "SELECT COALESCE(sum(quantity),0) AS quantity FROM commerce_cart_items WHERE owner_kind=$1 AND owner_id=$2",
  [owner.kind,owner.id],
 );
 return Number(rows[0].quantity);
}
export async function currentCartOwner(create = false): Promise<CartOwner | null> {
 const {currentAccount}=await import("@/modules/auth/session");
 const account = await currentAccount();
 if (account?.approved) return { kind: "account", id: account.id };
 const guest = await currentGuestCartOwner();
 if (guest) return guest;
 const jar = await cookies();
 if (!create) return null;
 const nextToken = randomBytes(32).toString("hex");
 const id = tokenHash(nextToken);
 await db.query("INSERT INTO guest_carts(token_hash) VALUES ($1)", [id]);
 jar.set("gb_cart", nextToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30*86400, path: "/" });
 return { kind: "guest", id };
}
export async function currentGuestCartOwner(): Promise<CartOwner | null> {
 const jar = await cookies();
 const token = jar.get("gb_cart")?.value;
 if (token && /^[a-f0-9]{64}$/.test(token)) {
  const id = tokenHash(token);
  const result = await db.query("SELECT token_hash FROM guest_carts WHERE token_hash=$1 AND expires_at>now()", [id]);
  if (result.rowCount) return { kind: "guest", id };
 }
 return null;
}
export async function lockCartOwner(client: PoolClient, owner: CartOwner) {
 const result = owner.kind === 'account'
  ? await client.query('SELECT id FROM accounts WHERE id=$1 AND approved FOR UPDATE',[owner.id])
  : await client.query('SELECT token_hash FROM guest_carts WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[owner.id]);
 if (!result.rowCount) throw new Error('Sepet oturumu sona erdi.');
}
export async function cartFor(owner: CartOwner | null, connection: Pick<PoolClient,'query'> = db): Promise<CartItem[]> {
 if (!owner) return [];
 // Keep removed/unpublished products visible so they can be removed, never silently ordered.
 return (await connection.query<CartItem>(`SELECT COALESCE(p.id,c.product_id) id,
 COALESCE(p.name,'Ürün artık satışta değil') name,COALESCE(p.code,'') code,COALESCE(p.brand,'') brand,
 p.category,p.supplier,p.description,p.price_kurus,p.stock,p.source,p.oem,p.pricing_snapshot,
 COALESCE(p.available,false) available,COALESCE(p.max_quantity,0) max_quantity,
 COALESCE(p.stock_label,'Ürün artık satışta değil') stock_label,c.quantity,c.vehicle
 FROM commerce_cart_items c LEFT JOIN (${catalogSql}) p ON p.id=c.product_id
 WHERE c.owner_kind=$2 AND c.owner_id=$3 ORDER BY p.code,c.product_id`,
 [process.env.BASBUG_FIRMA_ADI || 'BASBUG',owner.kind,owner.id])).rows;
}
/** `vehicle` is the garage vehicle at the time of adding; omit it to keep the line's earlier one. */
export async function setCartQuantity(owner: CartOwner, productId: string, quantity: number, add = false, vehicle?: GarageVehicle | null) {
 if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) throw new Error("Geçersiz adet.");
 const client = await db.connect();
 try {
  await client.query('BEGIN'); await lockCartOwner(client,owner);
  if (!quantity) {
   await client.query('DELETE FROM commerce_cart_items WHERE owner_kind=$1 AND owner_id=$2 AND product_id=$3',[owner.kind,owner.id,productId]);
  } else {
   const p=(await client.query<CatalogProduct>(`SELECT * FROM (${catalogSql}) p WHERE id=$2`,[process.env.BASBUG_FIRMA_ADI || 'BASBUG',productId])).rows[0];
   const old=(await client.query<{quantity:number}>('SELECT quantity FROM commerce_cart_items WHERE owner_kind=$1 AND owner_id=$2 AND product_id=$3',[owner.kind,owner.id,productId])).rows[0];
   const next=quantity+(add ? old?.quantity ?? 0 : 0);
   if (!p?.available || !p.price_kurus || next>p.max_quantity) { await client.query('ROLLBACK'); return false; }
   await client.query(`INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity,vehicle) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(owner_kind,owner_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity,vehicle=CASE WHEN $6 THEN EXCLUDED.vehicle ELSE commerce_cart_items.vehicle END`,
    [owner.kind,owner.id,productId,next,vehicle ? JSON.stringify(vehicle) : null,vehicle!==undefined]);
  }
  await client.query('COMMIT'); return true;
 } catch(error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
export async function mergeGuestCart(accountId: string) {
 const jar = await cookies(); const token = jar.get("gb_cart")?.value;
 if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
 const client=await db.connect();
 try {
  await client.query('BEGIN');
  await lockCartOwner(client,{kind:'account',id:accountId});
  const guest=await client.query('SELECT token_hash FROM guest_carts WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[tokenHash(token)]);
  if (guest.rowCount) {
   await client.query(`INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity,vehicle) SELECT 'account',$1,product_id,quantity,vehicle FROM commerce_cart_items WHERE owner_kind='guest' AND owner_id=$2
    ON CONFLICT(owner_kind,owner_id,product_id) DO UPDATE SET quantity=LEAST(99,commerce_cart_items.quantity+EXCLUDED.quantity),vehicle=COALESCE(EXCLUDED.vehicle,commerce_cart_items.vehicle)`,[accountId,tokenHash(token)]);
   await client.query("DELETE FROM commerce_cart_items WHERE owner_kind='guest' AND owner_id=$1",[tokenHash(token)]);
   // Preserve the guest session for access to earlier guest orders.
  }
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
