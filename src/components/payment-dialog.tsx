"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, LockKeyhole, X } from "lucide-react";
import { paymentState } from "@/app/siparis/[id]/actions";
import { PAYMENT_WINDOW, paymentErrors } from "@/modules/payments/messages";

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
export function PaymentDialog({ orderId, popup, total, onDismiss }: {
  orderId: string; popup: Window | null; total: string; onDismiss: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
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

  useEffect(() => { dialog.current?.showModal(); }, []);

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
  const dismiss = () => { windowRef.current?.close(); dialog.current?.close(); onDismiss(); };

  const error = typeof phase === "object" ? paymentErrors[phase.error] ?? paymentErrors.closed : null;
  const title = paid ? "Ödemen alındı" : error ? "Ödeme başlatılamadı" : phase === "open" ? "Ödeme penceresi açık" : "Ödeme tamamlanmadı";
  const text = paid ? "Siparişine yönlendiriliyorsun…"
    : error ?? (phase === "open" ? "Kart bilgilerini açılan TAMI güvenli ödeme penceresine gir. Ödeme tamamlanınca bu ekran kendiliğinden güncellenir."
      : phase === "blocked" ? "Tarayıcın ödeme penceresini engelledi. Aşağıdaki butonla pencereyi aç."
      : phase === "returned" ? "Ödemen doğrulanamadı. Kart işlemi reddedildiyse ya da yarıda kaldıysa yeniden deneyebilirsin; tamamladıysan birkaç saniye içinde güncellenecek."
      : "Ödeme penceresi kapandı. Ödemeyi tamamlamadıysan yeniden deneyebilirsin; siparişin ve sepetin korunuyor.");
  const canRetry = !paid && (!error || error === paymentErrors.provider);

  return <dialog ref={dialog} className="payment-dialog" aria-labelledby="payment-dialog-title" onCancel={event => { event.preventDefault(); if (!paid) dismiss(); }}>
    {!paid && <button className="purchase-close" onClick={dismiss} aria-label="Ödeme penceresini kapat"><X size={20}/></button>}
    <div className={`payment-dialog-icon${paid ? " is-paid" : ""}`}>{paid ? <CheckCircle2 size={32}/> : <LockKeyhole size={28}/>}</div>
    <h2 id="payment-dialog-title">{title}</h2>
    <p className="payment-dialog-total">{total}</p>
    <p className={error ? "error" : "payment-dialog-text"} role="status">{text}</p>
    {phase === "open" && <span className="payment-dialog-progress" aria-hidden/>}
    {!paid && <div className="payment-dialog-actions">
      {phase === "open" ? <button className="purchase-primary" onClick={focus}><ExternalLink size={18}/>Ödeme penceresine git</button>
        : canRetry && <button className="purchase-primary" onClick={retry}><LockKeyhole size={18}/>{phase === "blocked" ? "Ödeme penceresini aç" : "Yeniden dene"}</button>}
      <button className="purchase-outline" onClick={dismiss}>Daha sonra öde</button>
    </div>}
    {!paid && <small className="payment-dialog-note">Kart bilgilerin TAMI’de işlenir, Getirbakım’a iletilmez. Siparişin ödeme süresi boyunca sipariş sayfasından tekrar ödeyebilirsin.</small>}
  </dialog>;
}
