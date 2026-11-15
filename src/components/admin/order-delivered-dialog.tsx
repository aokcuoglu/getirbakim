import { PackageCheck } from "lucide-react";
import { changeOrderStatus } from "@/modules/admin/commerce-actions";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** shipped → delivered (#605) is final, so it is confirmed first. */
export function OrderDeliveredDialog({ orderId, number, back }: { orderId: string; number: string; back: string }) {
  return <AlertDialog>
    <AlertDialogTrigger render={<Button aria-label={`#${number} siparişini teslim edildi olarak işaretle`}/>}>
      <PackageCheck data-icon="inline-start" aria-hidden="true"/>Teslim edildi
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>#{number} siparişini teslim edildi olarak işaretle?</AlertDialogTitle>
        <AlertDialogDescription>Bu işlem geri alınamaz; müşteri siparişin teslim edildiğini görür.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Vazgeç</AlertDialogCancel>
        <form action={changeOrderStatus}>
          <input type="hidden" name="id" value={orderId}/>
          <input type="hidden" name="back" value={back}/>
          <input type="hidden" name="status" value="delivered"/>
          <SubmitButton className="w-full" icon={<PackageCheck data-icon="inline-start" aria-hidden="true"/>}>Teslim edildi</SubmitButton>
        </form>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
