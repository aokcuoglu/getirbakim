"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, LockKeyhole, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { storeDialogAction, storeDialogContent, storeDialogOverlay } from "./store-dialog-classes";
import { paymentState } from "@/app/(store)/siparis/[id]/actions";
import { PAYMENT_NOTICE, PAYMENT_WINDOW, paymentErrors } from "@/modules/payments/messages";
import { installmentHint } from "@/modules/payments/installment-plan";
import {storeButton} from "@/components/store-button";

type Phase = "open" | "returned" | "closed" | "paid" | "blocked" | { error: string };

const LOADING_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Getirbakım ödeme</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;color:#212b36}</style></head>
<body><p>Güvenli ödeme sayfası hazırlanıyor…</p></body></html>`;

/** Must run synchronously inside the click/submit handler, otherwise the browser blocks the popup. */
export function openPaymentWindow() {
  const width = Math.min(520, screen.availWidth), height = Math.min(760, screen.availHeight);
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  const popup = window.open("", PAYMENT_WINDOW, `popup,width=${width},height=${height},left=${left},top=${top}`);
  try { if (popup && popup.location.href === "about:blank") { popup.document.write(LOADING_HTML); popup.document.close(); } }
  catch { /* Already on TAMI's page from an earlier attempt; the form below replaces it. */ }
  return popup;
}

/** Loads TAMI into the window opened by openPaymentWindow; callers do this once per attempt. */
export function loadPaymentWindow(orderId: string) {
  const form = document.createElement("form");
  form.method = "post"; form.action = "/api/payments/tami/start"; form.target = PAYMENT_WINDOW; form.hidden = true;
  const input = document.createElement("input");
  input.type = "hidden"; input.name = "orderId"; input.value = orderId;
  form.append(input); document.body.append(form); form.submit(); form.remove();
}

/**
 * Keeps the site open behind TAMI's hosted page: the page runs in a popup (it refuses to be framed)
 * while this dialog tracks it. The provider query decides the outcome, never the popup's return.
 */
export function PaymentDialog({ orderId, popup, total, installments = 1, onDismiss }: {
  orderId: string; popup: Window | null; total: string; installments?: number; onDismiss: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const windowRef = useRef<Window | null>(popup);
  const [phase, setPhase] = useState<Phase>(popup ? "open" : "blocked");
  const paid = phase === "paid";

  const check = useCallback(async () => {
    const state = await paymentState(orderId).catch(() => null);
    if (!state) return false;
    if (state.endsWith(":paid")) { setPhase("paid"); return true; }
    // Expired or closed meanwhile: the order page explains it.
    if (!state.startsWith("awaiting_payment:")) { router.push(`/siparis/${orderId}`); return true; }
    return false;
  }, [orderId, router]);

  useEffect(() => {
    if (paid) { const timer = setTimeout(() => { router.push(`/siparis/${orderId}?odeme=sonuc`); router.refresh(); }, 1500); return () => clearTimeout(timer); }
    let stopped = false;
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.type !== "tami-payment" || event.data.orderId !== orderId) return;
      const result = String(event.data.result);
      if (result !== "sonuc") { setPhase({ error: result }); return; }
      if (!await check() && !stopped) setPhase("returned");
    };
    // A closed popup may still have paid; the poll below keeps asking TAMI.
    const watch = setInterval(() => {
      const current = windowRef.current;
      if (current?.closed) { windowRef.current = null; setPhase(p => p === "open" ? "closed" : p); }
    }, 500);
    const poll = setInterval(() => { void check(); }, 4000);
    window.addEventListener("message", onMessage);
    return () => { stopped = true; clearInterval(watch); clearInterval(poll); window.removeEventListener("message", onMessage); };
  }, [orderId, paid, check, router]);

  const retry = () => {
    const next = openPaymentWindow();
    windowRef.current = next;
    if (!next) { setPhase("blocked"); return; }
    setPhase("open");
    loadPaymentWindow(orderId);
  };
  const focus = () => { if (windowRef.current && !windowRef.current.closed) windowRef.current.focus(); else retry(); };
  const dismiss = () => { windowRef.current?.close(); setOpen(false); onDismiss(); };

  const error = typeof phase === "object" ? paymentErrors[phase.error] ?? paymentErrors.closed : null;
  const title = paid ? "Ödemen alındı" : error ? "Ödeme başlatılamadı" : phase === "open" ? "Ödemeni tamamla" : "Ödeme henüz tamamlanmadı";
  const text = paid ? "Siparişine yönlendiriliyorsun…"
    : error ?? (phase === "open" ? "Kart bilgilerini açılan TAMI güvenli ödeme penceresine gir. Ödeme tamamlanınca bu ekran kendiliğinden güncellenir."
      : phase === "blocked" ? "Tarayıcın ödeme penceresini engelledi. Aşağıdaki butonla pencereyi aç."
      : phase === "returned" ? "Ödemen doğrulanamadı. Kart işlemi reddedildiyse ya da yarıda kaldıysa yeniden deneyebilirsin; tamamladıysan birkaç saniye içinde güncellenecek."
      : "Ödeme penceresi kapandı. Ödemeyi tamamlamadıysan yeniden deneyebilirsin; siparişin ve sepetin korunuyor.");
  const canRetry = !paid && (!error || error === paymentErrors.provider);

  const action = storeDialogAction;
  return <Dialog open={open} disablePointerDismissal onOpenChange={next => { if (!next && !paid) dismiss(); }}>
    <DialogContent showCloseButton={false} overlayClassName={storeDialogOverlay} aria-labelledby="payment-dialog-title" className={storeDialogContent}>
        {!paid && <Button variant="secondary" className={cn(storeButton({intent:"ghost",size:"icon"}),"absolute top-1 right-1 bg-[#e6e9ec] hover:bg-[#d9dfe4]")} onClick={dismiss} aria-label="Ödeme penceresini kapat"><X className="size-5" aria-hidden/></Button>}
        <div className={cn("mx-auto grid size-14 place-items-center rounded-full", paid ? "bg-[#ebf5ed] text-[#2e7d32]" : "bg-[#e5f2fa] text-primary")}>{paid ? <CheckCircle2 className="size-8" aria-hidden/> : <LockKeyhole className="size-7" aria-hidden/>}</div>
        <DialogTitle id="payment-dialog-title" className="mt-4 mb-1 text-[22px] leading-7 font-semibold tracking-[-0.4px]">{title}</DialogTitle>
        <p className="mb-4 text-xl font-semibold text-primary">{total}</p>
        {!paid && installments > 1 && <p className="-mt-2 mb-4 text-sm leading-[22px] font-medium text-[#454f5b]">{installmentHint(installments)}.</p>}
        {error ? <Alert role="status" className="rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]">{text}</Alert>
          : <p className="m-0 text-sm leading-[22px] text-[#454f5b]" role="status">{text}</p>}
        {phase === "open" && <>
          <span className="mt-5 block h-[3px] animate-[payment-progress_1.4s_linear_infinite] rounded-[3px] bg-[linear-gradient(90deg,#e5f2fa_0,#007bc4_50%,#e5f2fa_100%)] bg-size-[200%_100%] motion-reduce:animate-none motion-reduce:bg-primary" aria-hidden/>
        </>}
        {!paid && <div className="mt-6 grid gap-2.5">
          {phase === "open" ? <Button className={cn(action, "font-semibold hover:bg-brand-strong")} onClick={focus}><ExternalLink className="size-[18px]" aria-hidden/>Ödeme penceresine git</Button>
            : canRetry && <Button className={cn(action, "font-semibold hover:bg-brand-strong")} onClick={retry}><LockKeyhole className="size-[18px]" aria-hidden/>{phase === "blocked" ? "Ödeme penceresini aç" : "Yeniden dene"}</Button>}
          <Button variant="outline" className={cn(action, "border-control-border bg-white font-medium text-foreground hover:bg-muted")} onClick={dismiss}>Daha sonra öde</Button>
        </div>}
        {!paid && <small className="mt-[18px] block text-xs leading-[18px] text-muted-foreground">{PAYMENT_NOTICE} Siparişin ödeme süresi boyunca sipariş sayfasından tekrar ödeyebilirsin.</small>}
    </DialogContent>
  </Dialog>;
}
