"use client";
import { useRef, type Ref } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { cancelOrder } from "@/app/(store)/siparis/[id]/actions";
import { storeDialogContent, storeDialogOverlay } from "./store-dialog-classes";
import { storeButton } from "@/components/store-button";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="destructive" disabled={pending} className={cn(storeButton({ intent: "danger", size: "lg" }), "w-full gap-2.5")}>{pending ? "İptal ediliyor…" : "Siparişi iptal et"}</Button>;
}

function KeepButton({ ref }: { ref: Ref<HTMLButtonElement> }) {
  const { pending } = useFormStatus();
  return <DialogClose ref={ref} disabled={pending} render={<Button type="button" variant="outline" className={cn(storeButton({ intent: "outline", size: "lg" }), "w-full")}/>}>Vazgeç</DialogClose>;
}

/**
 * Customer cancel (#607) with a confirmation step. The stock Dialog is used as an alert dialog (role="alertdialog",
 * no outside-click dismissal) because it takes the storefront overlay, which the stock AlertDialog does not.
 * `expected` is the status the customer saw; the server refuses the cancel if it changed meanwhile. `paid` tells whether a
 * refund follows. Focus opens on "Vazgeç", the safe choice.
 */
export function CancelOrderButton({ orderId, number, expected, total, paid }: {
  orderId: string; number: string; expected: "awaiting_payment" | "pending"; total: string; paid: boolean;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  // An unpaid order's cart is untouched (it is only cleared once a payment is recorded), so the customer can reorder.
  const body = paid
    ? `#${number} numaralı siparişin iptal edilecek. ${total} tutarındaki ödemenin iadesini ekibimiz başlatır; iade tamamlanınca bu sayfada görürsün. Bu işlem geri alınamaz.`
    : expected === "awaiting_payment"
      ? `#${number} numaralı siparişin iptal edilecek. Kartından tahsilat yapılmadı. Sepetin korunur; istersen yeniden sipariş verebilirsin. Bu işlem geri alınamaz.`
      : `#${number} numaralı siparişin iptal edilecek. Bu sipariş için ödeme alınmadı. Bu işlem geri alınamaz.`;
  return <Dialog disablePointerDismissal>
    <DialogTrigger render={<Button variant="ghost" className={cn(storeButton({ intent: "ghost", size: "md" }), "text-muted-foreground hover:text-destructive")}/>}>Siparişi iptal et</DialogTrigger>
    <DialogContent showCloseButton={false} role="alertdialog" initialFocus={keep} overlayClassName={storeDialogOverlay} className={storeDialogContent}>
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-destructive-subtle text-destructive-strong"><CircleAlert className="size-7" aria-hidden/></div>
      <DialogTitle className="mt-4 mb-2 text-[22px] leading-7 font-semibold tracking-[-0.4px]">Siparişi iptal edelim mi?</DialogTitle>
      <DialogDescription className="m-0 text-sm leading-[22px] text-[#454f5b]">{body}</DialogDescription>
      <form action={cancelOrder} className="mt-6 grid gap-2.5">
        <input type="hidden" name="orderId" value={orderId}/>
        <input type="hidden" name="expected" value={expected}/>
        <ConfirmButton/>
        <KeepButton ref={keep}/>
      </form>
    </DialogContent>
  </Dialog>;
}
