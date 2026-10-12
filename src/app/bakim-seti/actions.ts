"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentCartOwner, setCartQuantity } from "@/modules/store/cart";
import { currentVehicle } from "@/modules/store/garage";

/** Adds every product of the kit with the garage vehicle; reports the ones that could not be added. */
export async function addKitToCart(productIds: string[]): Promise<{ added: number; failed: string[]; error?: string }> {
  const input = z.array(z.uuid()).min(1).max(5).safeParse(productIds);
  if (!input.success) return { added: 0, failed: [], error: "Set ürünlerini kontrol et." };
  const owner = await currentCartOwner(true);
  if (!owner) return { added: 0, failed: [], error: "Sepet oturumu oluşturulamadı." };
  const vehicle = await currentVehicle();
  const failed: string[] = [];
  for (const id of input.data) if (!await setCartQuantity(owner, id, 1, true, vehicle)) failed.push(id);
  revalidatePath("/", "layout");
  return { added: input.data.length - failed.length, failed };
}
