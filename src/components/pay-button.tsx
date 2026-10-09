"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { PaymentDialog, loadPaymentWindow, openPaymentWindow } from "./payment-dialog";

/** Retry/pay later from the order page; without JS the form opens TAMI in a new tab. */
export function PayButton({orderId,total,children}:{orderId:string;total:string;children?:ReactNode}) {
  const router=useRouter();
  const [payment,setPayment]=useState<{key:number;popup:Window|null}|null>(null);
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const popup=openPaymentWindow();
    if(popup) loadPaymentWindow(orderId);
    setPayment({key:Date.now(),popup});
  };
  return <>
    <form method="post" action="/api/payments/tami/start" target="_blank" onSubmit={submit} className="inline-form"><input type="hidden" name="orderId" value={orderId}/>
      <button className="purchase-primary"><LockKeyhole size={18}/>Kartla öde · {total}</button>{children}</form>
    {payment && <PaymentDialog key={payment.key} orderId={orderId} popup={payment.popup} total={total} onDismiss={()=>{setPayment(null);router.refresh();}}/>}
  </>;
}
