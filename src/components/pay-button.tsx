"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <form method="post" action="/api/payments/tami/start" target="_blank" onSubmit={submit} className="flex items-end gap-[15px]"><input type="hidden" name="orderId" value={orderId}/>
      <Button type="submit" className="h-auto min-h-12 flex-1 gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5 font-semibold hover:bg-brand-strong"><LockKeyhole className="size-[18px]" aria-hidden/>Kartla öde · {total}</Button>{children}</form>
    {payment && <PaymentDialog key={payment.key} orderId={orderId} popup={payment.popup} total={total} onDismiss={()=>{setPayment(null);router.refresh();}}/>}
  </>;
}
