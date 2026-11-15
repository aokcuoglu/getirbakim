"use server";
import { z } from "zod";
import { cartQuantity, currentCartOwner, setCartQuantity } from "@/modules/store/cart";
import { currentVehicle } from "@/modules/store/garage";
import { maxKitImageItems } from "@/modules/store/maintenance-kit";

const kitInput = z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99), name: z.string().trim().max(200) }))
  .min(1).max(maxKitImageItems);
/** `cartCount` is the cart's total quantity when something was added (feeds the header badge). */
export type KitCartResult = { added: number; failed: string[]; error?: string; cartCount?: number };

/** Adds every piece of the kit to the cart (one line per product, with the garage vehicle); pieces that cannot be sold now are reported, the rest still go in. */
export async function addKitToCart(items: z.input<typeof kitInput>): Promise<KitCartResult> {
  const input = kitInput.safeParse(items);
  if (!input.success) return { added: 0, failed: [], error: "Set içeriği geçersiz." };
  const owner = await currentCartOwner(true);
  if (!owner) return { added: 0, failed: [], error: "Sepet oturumu oluşturulamadı." };
  const vehicle = await currentVehicle();
  const failed: string[] = [];
  let added = 0;
  for (const item of input.data) {
    if (await setCartQuantity(owner, item.productId, item.quantity, true, vehicle)) added++;
    else failed.push(item.name || item.productId);
  }
  return added ? { added, failed, cartCount: await cartQuantity(owner) } : { added, failed };
}
