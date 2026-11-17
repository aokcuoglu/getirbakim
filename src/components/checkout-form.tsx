"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { checkout, placeOrder } from "@/app/(store)/sepet/actions";
import { CheckoutErrorAlert, cartLineNames, type CheckoutError } from "./checkout-error-alert";
import { Button } from "@/components/ui/button";
import { PaymentDialog, loadPaymentWindow, openPaymentWindow } from "./payment-dialog";
import { addPaymentInfo, type AnalyticsItem } from "@/modules/analytics/events";
import { track } from "@/modules/analytics/track";
import { money } from "@/modules/store/money";
import { useInstallment } from "./checkout-installments";

/**
 * Creates the order and opens TAMI over this page. The popup is opened before the order request,
 * while the click still counts as a user gesture; without JS the form falls back to the order page.
 */
export function CheckoutForm({children,disabled,total,errors,lineNames={},initialError=null,analyticsItems}:{children:ReactNode;disabled:boolean;total:string;errors:Record<string,string>;lineNames?:Record<string,string>;initialError?:CheckoutError|null;analyticsItems?:AnalyticsItem[]}) {
  const router=useRouter();
  const [pending,setPending]=useState(false);
  // Starts with the no-JS redirect's error (?error=); the next attempt replaces it.
  const [error,setError]=useState<CheckoutError|null>(initialError);
  const [payment,setPayment]=useState<{orderId:string;popup:Window|null}|null>(null);
  const busy=useRef(false);
  // With payment options (#886) the dialog shows the chosen option's total and its hosted-page hint.
  const option=useInstallment()?.selected;
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
        // Lines the supplier refused live (#788) are named with the cart's names.
        setError({code:result.error,names:cartLineNames(result.products??[],lineNames),field:result.field});router.refresh();return;
      }
      // The order exists and card payment starts now (#675); nothing about the customer goes along.
      if(analyticsItems?.length) track("add_payment_info",addPaymentInfo(analyticsItems));
      if(popup) loadPaymentWindow(result.id);
      setPayment({orderId:result.id,popup});
    } catch {
      popup?.close();setError({code:"supplier",names:[]});
    } finally { busy.current=false;setPending(false); }
  };
  return <>
    {error && <CheckoutErrorAlert error={error} errors={errors}/>}
    <form action={checkout} onSubmit={submit} className="grid gap-4">{children}
      <noscript><p className="m-0 text-sm leading-5 text-destructive">Siparişi tamamlamak için JavaScript gerekir. Tarayıcında JavaScript&apos;i açıp sayfayı yenile.</p></noscript>
      <Button type="submit" className="mt-2 h-auto min-h-12 w-full gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5 font-semibold hover:bg-brand-strong disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-muted-foreground disabled:opacity-100" disabled={disabled || pending || payment!==null}><LockKeyhole className="size-[18px]" aria-hidden/>{pending ? "Ödeme sayfası hazırlanıyor…" : "Ödemeye geç"}</Button>
    </form>
    {payment && <PaymentDialog orderId={payment.orderId} popup={payment.popup} total={option ? money(option.totalKurus) : total} installments={option?.count} onDismiss={()=>router.push(`/siparis/${payment.orderId}`)}/>}
  </>;
}
