"use server";
import { currentCartOwner, setCartQuantity } from "@/modules/store/cart";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
export async function updateCart(form: FormData) {
 const input=z.object({productId:z.uuid(),quantity:z.coerce.number().int().min(0).max(99),mode:z.enum(["add","set"]).default("set")}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect("/sepet?error=1");
 const owner=await currentCartOwner(true);
 if(!owner) throw new Error("Sepet oluşturulamadı.");
 const ok=await setCartQuantity(owner,input.data.productId,input.data.quantity,input.data.mode==="add");
 revalidatePath("/", "layout"); redirect(ok ? "/sepet" : "/sepet?error=stock");
}

export async function checkout(form:FormData) {
 const input=z.object({requestKey:z.uuid(),quote:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(2).max(150),email:z.email().max(200),phone:z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/),address:z.string().trim().min(15).max(1000),note:z.string().trim().max(1000),consent:z.literal('on')}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/sepet?error=validation');
 const owner=await currentCartOwner();
 if(!owner) redirect('/sepet?error=session');
 const {submitOrder}=await import('@/modules/store/orders');
 const result=await submitOrder(owner,input.data);
 if(result.error) redirect(`/sepet?error=${result.error}`);
 revalidatePath('/','layout');redirect(`/siparis/${result.id}`);
}
