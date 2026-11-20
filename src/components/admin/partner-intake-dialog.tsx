import { CirclePause } from "lucide-react";
import { setPartnerIntake } from "@/modules/admin/partner-actions";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Pausing a partner's order intake (#1009) refuses its new quotes and orders at once, so it is confirmed first. */
export function PartnerIntakeDialog({ partner }: { partner: string }) {
  return <AlertDialog>
    <AlertDialogTrigger render={<Button variant="outline" aria-label={`${partner}: Sipariş alımını durdur`}/>}>
      <CirclePause data-icon="inline-start" aria-hidden="true"/>Sipariş alımını durdur
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{partner} için sipariş alımı durdurulsun mu?</AlertDialogTitle>
        <AlertDialogDescription>Partner yeni teklif alamaz ve yeni sipariş veremez. Mevcut siparişler etkilenmez; partner siparişlerini izlemeye ve iptal etmeye devam eder. İstediğiniz zaman yeniden açabilirsiniz.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Vazgeç</AlertDialogCancel>
        <form action={setPartnerIntake}>
          <input type="hidden" name="partner" value={partner}/>
          <input type="hidden" name="paused" value="1"/>
          <SubmitButton variant="destructive" icon={<CirclePause data-icon="inline-start" aria-hidden="true"/>}>Durdur</SubmitButton>
        </form>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
