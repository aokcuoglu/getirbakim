"use client";
import { useFormStatus } from "react-dom";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { cancelOrder } from "@/app/(store)/siparis/[id]/actions";
import { storeDialogAction, storeDialogContent, storeDialogOverlay } from "./store-dialog-classes";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="destructive" disabled={pending} className={cn(storeDialogAction, "font-semibold")}>{pending ? "İptal ediliyor…" : "Siparişi iptal et"}</Button>;
}

/**
 * Customer cancel (#607) with a confirmation step. The stock Dialog is used as an alert dialog (role="alertdialog",
 * no outside-click dismissal) because it takes the storefront overlay, which the stock AlertDialog does not.
 * `expected` is the status the customer saw; the server refuses the cancel if it changed meanwhile.
 */
export function CancelOrderButton({ orderId, number, expected, total }: {
  orderId: string; number: string; expected: "awaiting_payment" | "pending"; total: string;
}) {
  const body = expected === "awaiting_payment"
    ? `#${number} numaralı siparişin iptal edilecek. Kartından tahsilat yapılmadı. Sepetin korunur; istersen yeniden sipariş verebilirsin. Bu işlem geri alınamaz.`
    : `#${number} numaralı siparişin iptal edilecek. ${total} tutarındaki ödemenin iadesini ekibimiz başlatır; iade tamamlanınca bu sayfada görürsün. Kartına yansıması bankana göre birkaç iş günü sürebilir. Bu işlem geri alınamaz.`;
  return <Dialog disablePointerDismissal>
    <DialogTrigger render={<Button variant="outline" className="h-auto min-h-12 gap-2.5 rounded-lg border-input bg-white px-5 py-3 text-sm leading-5 font-medium text-foreground hover:bg-muted"/>}>Siparişi iptal et</DialogTrigger>
    <DialogContent showCloseButton={false} role="alertdialog" overlayClassName={storeDialogOverlay} className={storeDialogContent}>
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#fff0ec] text-[#a74130]"><CircleAlert className="size-7" aria-hidden/></div>
      <DialogTitle className="mt-4 mb-2 text-[22px] leading-7 font-semibold tracking-[-0.4px]">Siparişi iptal edelim mi?</DialogTitle>
      <DialogDescription className="m-0 text-sm leading-[22px] text-[#454f5b]">{body}</DialogDescription>
      <form action={cancelOrder} className="mt-6 grid gap-2.5">
        <input type="hidden" name="orderId" value={orderId}/>
        <input type="hidden" name="expected" value={expected}/>
        <ConfirmButton/>
        <DialogClose render={<Button type="button" variant="outline" className={cn(storeDialogAction, "border-input bg-white font-medium text-foreground hover:bg-muted")}/>}>Vazgeç</DialogClose>
      </form>
    </DialogContent>
  </Dialog>;
}
