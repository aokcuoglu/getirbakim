"use server";
import { cartLineQuantity, cartProductIds, cartQuantity, currentCartOwner, setCartQuantity } from "@/modules/store/cart";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentAccount } from "@/modules/auth/session";
import { purchasePreview, suggestionPreviews } from "@/modules/store/purchase-preview";
import type { PurchasePreview, PurchaseState } from "@/modules/store/purchase-types";
import { currentVehicle } from "@/modules/store/garage";
import { headers } from "next/headers";
import { checkoutErrorField, checkoutInput } from "@/modules/store/checkout-schema";
import { saveCheckoutAddress } from "@/modules/store/account-addresses";
import { clientEvidence } from "@/lib/client-address";

export async function addToCart(_state: PurchaseState, form: FormData): Promise<PurchaseState> {
 const input=z.object({productId:z.uuid(),quantity:z.coerce.number().int().min(1).max(99)}).safeParse(Object.fromEntries(form));
 const failure = {added:null,suggestions:[]};
 if(!input.success) return {...failure,error:"Ürün ve adedi kontrol et."};
 const [owner,vehicle]=await Promise.all([currentCartOwner(true),currentVehicle()]);
 if(!owner) return {...failure,error:"Sepet oturumu oluşturulamadı."};
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity,true,vehicle);
 if(!ok) return {...failure,error:"Ürün fiyatı veya stok durumu uygun değil; sepetindeki adedi kontrol et."};
 // No revalidatePath: it would re-render the whole page; the header badge takes `cartCount` instead (#707).
 const [account,lineQuantity,cartIds,cartCount]=await Promise.all([currentAccount(),cartLineQuantity(owner,input.data.productId),cartProductIds(owner),cartQuantity(owner)]);
 const quantity=lineQuantity || input.data.quantity;
 const preview=await purchasePreview(input.data.productId,quantity,account?.approved && account.role==="service" ? account.discount_percent : 0,{vehicle,cartIds});
 if(!preview) return {...failure,error:"Ürün sepete eklendi; güncel durumunu sepetten kontrol et.",cartCount};
 return {...preview,error:null,addedQuantity:input.data.quantity,cartCount};
}

/** The add-to-cart dialog's related parts when they missed addToCart's time budget (#704); read-only, nothing is created. */
export async function loadCartSuggestions(productId: string): Promise<PurchasePreview[]> {
 const input=z.uuid().safeParse(productId);
 if(!input.success) return [];
 const [owner,vehicle,account]=await Promise.all([currentCartOwner(),currentVehicle(),currentAccount()]);
 const cartIds=owner ? await cartProductIds(owner) : [];
 return suggestionPreviews(input.data,account?.approved && account.role==="service" ? account.discount_percent : 0,{vehicle,cartIds});
}

/** `refreshPage` re-renders the cart page in the same response (totals + badge); the purchase popup only takes `cartCount`. */
export async function changeCartQuantity(productId: string, quantity: number, refreshPage = false) {
 const input=z.object({productId:z.uuid(),quantity:z.number().int().min(1).max(99)}).safeParse({productId,quantity});
 if(!input.success) return {error:"Geçersiz adet."};
 const owner=await currentCartOwner();
 if(!owner) return {error:"Sepet oturumu sona erdi."};
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity);
 if(!ok) return {error:"Bu adet için stok veya fiyat uygun değil."};
 if(refreshPage===true) refresh();
 return {quantity:input.data.quantity,cartCount:await cartQuantity(owner)};
}
export async function updateCart(form: FormData) {
 const input=z.object({productId:z.uuid(),quantity:z.coerce.number().int().min(0).max(99),mode:z.enum(["add","set"]).default("set")}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect("/sepet?error=1");
 const owner=await currentCartOwner(true);
 if(!owner) throw new Error("Sepet oluşturulamadı.");
 const add=input.data.mode==="add";
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity,add,add ? await currentVehicle() : undefined);
 refresh(); redirect(ok ? "/sepet" : "/sepet?error=stock");
}

/** Creates the awaiting-payment order; the cart is kept until TAMI confirms the payment. */
export async function placeOrder(form:FormData):Promise<{id:string;error?:undefined;products?:undefined;field?:undefined}|{error:string;products?:string[];field?:string;id?:undefined}> {
 const input=checkoutInput.safeParse(Object.fromEntries(form));
 // The first refused field (#881) lets the page say what to fix; only names from checkoutFieldErrors are returned.
 if(!input.success) return {error:'validation',field:checkoutErrorField(input.error.issues)};
 const owner=await currentCartOwner();
 if(!owner) return {error:'session'};
 const {submitOrder}=await import('@/modules/store/orders');
 const result=await submitOrder(owner,input.data,await currentVehicle(),clientEvidence(await headers()));
 if(result.error===undefined) {
  // Best effort after the order exists (#999): the saver never throws and its outcome is not shown.
  if(input.data.saveAddress) await saveCheckoutAddress(owner,input.data);
  revalidatePath('/','layout');
 }
 return result;
}

// The form's fallback when its JS submit did not run. Checkout needs JS since #881 (the province and district lists;
// the form says so in <noscript>), but this path still handles a post that arrives without it: errors go back to the
// form as ?error= (and ?alan= for a refused field), an order goes to its page, which opens TAMI in a new tab.
export async function checkout(form:FormData) {
 const result=await placeOrder(form);
 if(result.error==='session') redirect('/sepet?error=session');
 // The order page names refused lines (#788) from the cart, never from this parameter's text.
 if(result.error!==undefined) redirect(`/siparis-olustur?error=${result.error}${result.products?.length ? `&urun=${result.products.join(",")}` : ""}${result.field ? `&alan=${result.field}` : ""}`);
 redirect(`/siparis/${result.id}?odeme=yeni`);
}
