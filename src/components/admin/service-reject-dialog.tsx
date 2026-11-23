import { rejectServiceApplication } from "@/modules/admin/actions";
import { SubmitButton } from "@/components/admin/submit-button";
import { PendingDialogCancel } from "@/components/admin/pending-dialog-cancel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Rejecting a customer's service-account request (#1259) is confirmed first; the account stays a customer. */
export function ServiceRejectDialog({ accountId, name }: { accountId: string; name: string }) {
  return <AlertDialog>
    <AlertDialogTrigger render={<Button variant="outline" aria-label={`Başvuruyu reddet: ${name}`}/>}>Başvuruyu reddet</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Başvuru reddedilsin mi?</AlertDialogTitle>
        <AlertDialogDescription>Hesap bireysel müşteri olarak kalır; müşteri yeniden başvurabilir.</AlertDialogDescription>
      </AlertDialogHeader>
      <form action={rejectServiceApplication}>
        <input type="hidden" name="id" value={accountId}/>
        <AlertDialogFooter>
          <PendingDialogCancel>Vazgeç</PendingDialogCancel>
          <SubmitButton variant="destructive">Reddet</SubmitButton>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}
