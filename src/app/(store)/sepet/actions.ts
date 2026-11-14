"use server";
import { currentCartOwner, setCartQuantity } from "@/modules/store/cart";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentAccount } from "@/modules/auth/session";
import { cartFor } from "@/modules/store/cart";
import { purchasePreview } from "@/modules/store/purchase-preview";
import type { PurchaseState } from "@/modules/store/purchase-types";
import { currentVehicle } from "@/modules/store/garage";

export async function addToCart(_state: PurchaseState, form: FormData): Promise<PurchaseState> {
 const input=z.object({productId:z.uuid(),quantity:z.coerce.number().int().min(1).max(99)}).safeParse(Object.fromEntries(form));
 const failure = {added:null,suggestions:[]};
 if(!input.success) return {...failure,error:"Ürün ve adedi kontrol et."};
 const owner=await currentCartOwner(true);
 if(!owner) return {...failure,error:"Sepet oturumu oluşturulamadı."};
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity,true,await currentVehicle());
 if(!ok) return {...failure,error:"Ürün fiyatı veya stok durumu uygun değil; sepetindeki adedi kontrol et."};
 revalidatePath("/", "layout");
 const [account,items]=await Promise.all([currentAccount(),cartFor(owner)]);
 const quantity=items.find(p=>p.id===input.data.productId)?.quantity ?? input.data.quantity;
 const preview=await purchasePreview(input.data.productId,quantity,account?.approved && account.role==="service" ? account.discount_percent : 0);
 if(!preview) return {...failure,error:"Ürün sepete eklendi; güncel durumunu sepetten kontrol et."};
 return {...preview,error:null};
}

export async function changeCartQuantity(productId: string, quantity: number) {
 const input=z.object({productId:z.uuid(),quantity:z.number().int().min(1).max(99)}).safeParse({productId,quantity});
 if(!input.success) return {error:"Geçersiz adet."};
 const owner=await currentCartOwner();
 if(!owner) return {error:"Sepet oturumu sona erdi."};
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity);
 if(!ok) return {error:"Bu adet için stok veya fiyat uygun değil."};
 revalidatePath("/", "layout");
 return {quantity:input.data.quantity};
}
export async function updateCart(form: FormData) {
 const input=z.object({productId:z.uuid(),quantity:z.coerce.number().int().min(0).max(99),mode:z.enum(["add","set"]).default("set")}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect("/sepet?error=1");
 const owner=await currentCartOwner(true);
 if(!owner) throw new Error("Sepet oluşturulamadı.");
 const add=input.data.mode==="add";
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity,add,add ? await currentVehicle() : undefined);
 revalidatePath("/", "layout"); redirect(ok ? "/sepet" : "/sepet?error=stock");
}

const checkoutInput=z.object({requestKey:z.uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(2).max(150),email:z.email().max(200),phone:z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/),address:z.string().trim().min(15).max(1000),note:z.string().trim().max(1000),consent:z.literal('on')});

/** Creates the awaiting-payment order; the cart is kept until TAMI confirms the payment. */
export async function placeOrder(form:FormData):Promise<{id:string;error?:undefined}|{error:string;id?:undefined}> {
 const input=checkoutInput.safeParse(Object.fromEntries(form));
 if(!input.success) return {error:'validation'};
 const owner=await currentCartOwner();
 if(!owner) return {error:'session'};
 const {submitOrder}=await import('@/modules/store/orders');
 const result=await submitOrder(owner,input.data,await currentVehicle());
 if(result.error===undefined) revalidatePath('/','layout');
 return result;
}

// Without JS the form posts here; the order page then opens TAMI in a new tab.
export async function checkout(form:FormData) {
 const result=await placeOrder(form);
 if(result.error==='session') redirect('/sepet?error=session');
 if(result.error!==undefined) redirect(`/siparis-olustur?error=${result.error}`);
 redirect(`/siparis/${result.id}?odeme=yeni`);
}
