"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { paymentState } from "@/app/siparis/[id]/actions";

/** Refreshes the order once TAMI's tab completes the payment (or the order expires). */
export function PaymentWatcher({orderId,state}:{orderId:string;state:string}) {
  const router=useRouter();
  useEffect(()=>{
    let stopped=false,busy=false;
    const check=async()=>{
      if(busy || stopped || document.visibilityState==="hidden") return;
      busy=true;
      try { const next=await paymentState(orderId); if(next && next!==state && !stopped) { stopped=true; router.refresh(); } }
      catch { /* The next tick retries. */ }
      finally { busy=false; }
    };
    const timer=setInterval(check,5000);
    // Returning from TAMI's tab should update immediately.
    const onFocus=()=>{ void check(); };
    window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onFocus);
    return ()=>{ stopped=true;clearInterval(timer);window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onFocus); };
  },[orderId,state,router]);
  return null;
}
