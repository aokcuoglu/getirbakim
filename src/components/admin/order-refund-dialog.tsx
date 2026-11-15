import { RotateCcw } from "lucide-react";
import { refundViaTami } from "@/modules/admin/commerce-actions";
import type { ReversalKind } from "@/modules/payments/refund-rules";
import { money } from "@/modules/store/catalog";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Full TAMI void/refund of one captured payment attempt (#619). Money leaves the merchant account, so it is confirmed
 * first; the result is shown on the order list after the redirect.
 */
export function OrderRefundDialog({ orderId, number, paymentId, providerOrderId, amountKurus, kinds, several, back }: {
  orderId: string; number: string; paymentId: string; providerOrderId: string; amountKurus: number; kinds: ReversalKind[]; several: boolean; back: string;
}) {
  const label = several ? `${providerOrderId} iade et` : "TAMI'den iade et";
  return <AlertDialog>
    <AlertDialogTrigger render={<Button variant="destructive" aria-label={`#${number} siparişinin ${providerOrderId} ödemesini TAMI'den iade et`}/>}>
      <RotateCcw data-icon="inline-start" aria-hidden="true"/>{label}
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>#{number} — {money(amountKurus)} TAMI&apos;den iade edilsin mi?</AlertDialogTitle>
        <AlertDialogDescription>
          TAMI ödemesi {providerOrderId}, tutarın tamamı ({money(amountKurus)}).{" "}
          {kinds[0] === "void" ? "Bugün tahsil edildiği için önce iptal denenir; olmazsa iade edilir." : "İade olarak gönderilir."} Geri alınamaz.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Vazgeç</AlertDialogCancel>
        <form action={refundViaTami}>
          <input type="hidden" name="order" value={orderId}/>
          <input type="hidden" name="payment" value={paymentId}/>
          <input type="hidden" name="back" value={back}/>
          <SubmitButton variant="destructive" className="w-full" pendingLabel="TAMI'ye gönderiliyor…" icon={<RotateCcw data-icon="inline-start" aria-hidden="true"/>}>
            TAMI&apos;den iade et
          </SubmitButton>
        </form>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
