"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { checkout, placeOrder } from "@/app/sepet/actions";
import { PaymentDialog, loadPaymentWindow, openPaymentWindow } from "./payment-dialog";

/**
 * Creates the order and opens TAMI over this page. The popup is opened before the order request,
 * while the click still counts as a user gesture; without JS the form falls back to the order page.
 */
export function CheckoutForm({children,disabled,total,errors}:{children:ReactNode;disabled:boolean;total:string;errors:Record<string,string>}) {
  const router=useRouter();
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [payment,setPayment]=useState<{orderId:string;popup:Window|null}|null>(null);
  const busy=useRef(false);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(busy.current) return;
    busy.current=true;setPending(true);setError(null);
    const popup=openPaymentWindow();
    try {
      const result=await placeOrder(new FormData(event.currentTarget));
      if(result.error!==undefined) {
        popup?.close();
        if(result.error==="session") { router.push("/sepet?error=session"); return; }
        setError(errors[result.error]??errors.stock);router.refresh();return;
      }
      if(popup) loadPaymentWindow(result.id);
      setPayment({orderId:result.id,popup});
    } catch {
      popup?.close();setError(errors.supplier);
    } finally { busy.current=false;setPending(false); }
  };
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    <form action={checkout} onSubmit={submit} className="checkout-form">{children}
      <button className="purchase-primary" disabled={disabled || pending || payment!==null}><LockKeyhole size={18}/>{pending ? "Ödeme sayfası hazırlanıyor…" : "Ödemeye geç"}</button>
    </form>
    {payment && <PaymentDialog orderId={payment.orderId} popup={payment.popup} total={total} onDismiss={()=>router.push(`/siparis/${payment.orderId}`)}/>}
  </>;
}
