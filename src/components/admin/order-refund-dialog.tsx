import { RotateCcw } from "lucide-react";
import { refundViaTami } from "@/modules/admin/commerce-actions";
import type { ReversalKind } from "@/modules/payments/refund-rules";
import { money } from "@/modules/store/catalog";
import { PendingDialogCancel } from "@/components/admin/pending-dialog-cancel";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Full TAMI void/refund of one captured payment attempt (#619). Money leaves the merchant account, so it is confirmed
 * first; the result is shown on the order list after the redirect. One provider call per confirmation.
 */
export function OrderRefundDialog({ orderId, number, paymentId, providerOrderId, amountKurus, kind, several, orderPaid, back }: {
  orderId: string; number: string; paymentId: string; providerOrderId: string; amountKurus: number; kind: ReversalKind;
  several: boolean; orderPaid: boolean; back: string;
}) {
  const label = several ? `${money(amountKurus)} iade et` : "TAMI'den iade et";
  return <AlertDialog>
    <AlertDialogTrigger render={<Button variant="destructive" aria-label={`#${number} siparişi, ${providerOrderId} ödemesi: ${label}`}/>}>
      <RotateCcw data-icon="inline-start" aria-hidden="true"/>{label}
    </AlertDialogTrigger>
    <AlertDialogContent>
      <form action={refundViaTami} className="contents">
        <input type="hidden" name="order" value={orderId}/>
        <input type="hidden" name="payment" value={paymentId}/>
        <input type="hidden" name="back" value={back}/>
        <AlertDialogHeader>
          <AlertDialogTitle>#{number} — {money(amountKurus)} TAMI&apos;den iade edilsin mi?</AlertDialogTitle>
          <AlertDialogDescription>
            TAMI ödemesi {providerOrderId}, tutarın tamamı ({money(amountKurus)}).{" "}
            {kind === "void"
              ? "Bugün tahsil edildiği için iptal olarak gönderilir; TAMI iptali reddederse yeniden onayladığınızda iade olarak gönderilir."
              : "İade olarak gönderilir."}{" "}
            {orderPaid ? "Sipariş ödenmiş kalır; yalnız bu fazladan tahsilat iade edilir." : "Sipariş iade edildi olarak işaretlenir."} Geri alınamaz.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <PendingDialogCancel>Vazgeç</PendingDialogCancel>
          <SubmitButton variant="destructive" pendingLabel="TAMI'ye gönderiliyor…" icon={<RotateCcw data-icon="inline-start" aria-hidden="true"/>}>
            TAMI&apos;den iade et
          </SubmitButton>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}
