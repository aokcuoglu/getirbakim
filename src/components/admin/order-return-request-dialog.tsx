import { CircleCheck, CircleX } from "lucide-react";
import { decideReturnRequest } from "@/modules/admin/commerce-actions";
import type { AdminReturnRequest } from "@/modules/admin/data";
import { returnReasonLabels } from "@/modules/store/returns";
import { PendingDialogCancel } from "@/components/admin/pending-dialog-cancel";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Decision = "approve" | "reject";
type DecisionProps = { orderId: string; number: string; request: AdminReturnRequest; back: string };

/** Both decisions are final, so each is confirmed once more before it is sent. */
function DecisionDialog({ decision, orderId, number, request, back }: DecisionProps & { decision: Decision }) {
  const approve = decision === "approve";
  const units = request.lines.reduce((sum, line) => sum + line.quantity, 0);
  const icon = approve ? <CircleCheck data-icon="inline-start" aria-hidden="true"/> : <CircleX data-icon="inline-start" aria-hidden="true"/>;
  const label = approve ? "İadeyi onayla" : "Talebi reddet";
  return <AlertDialog>
    <AlertDialogTrigger render={<Button variant={approve ? "default" : "outline"} className="w-full sm:w-auto" aria-label={`#${number}: ${label}`}/>}>
      {icon}{label}
    </AlertDialogTrigger>
    <AlertDialogContent>
      <form action={decideReturnRequest} className="contents">
        <input type="hidden" name="id" value={request.id}/>
        <input type="hidden" name="order" value={orderId}/>
        <input type="hidden" name="decision" value={decision}/>
        <input type="hidden" name="back" value={back}/>
        <AlertDialogHeader>
          <AlertDialogTitle>{approve ? `#${number} — iade onaylansın mı?` : `#${number} — talep reddedilsin mi?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {approve
              ? `${request.lines.length} kalem (${units} adet) iade kaydına işlenir; cari hesap ve limit değişmez, iade faturasını ayrıca kesin.`
              : "Talep kapanır ve adetler yeniden iade edilebilir olur."}{" "}
            Partner kararı API&apos;de görür. Geri alınamaz.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <PendingDialogCancel>Vazgeç</PendingDialogCancel>
          <SubmitButton variant={approve ? "default" : "destructive"} pendingLabel="Kaydediliyor…" icon={icon}>{label}</SubmitButton>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}

/**
 * A partner's pending return request (#1007) on a shipped or delivered order. Approving records the lines as returns;
 * rejecting releases the quantity. Either way the partner sees the decision on its API.
 */
export function OrderReturnRequestDialog({ orderId, number, request, orderLines, back, requestedAt }: DecisionProps & {
  orderLines: { product_id: string; code: string; name: string }[];
  /** Shown in the trigger's accessible name when the order has several pending requests. */
  requestedAt: string | null;
}) {
  const lineOf = new Map(orderLines.map(line => [line.product_id, line]));
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" aria-label={`#${number}: İade talebini incele${requestedAt ? ` (talep ${requestedAt})` : ""}`}/>}>
      İade talebini incele
    </DialogTrigger>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>#{number} — partner iade talebi</DialogTitle>
        <DialogDescription>Onaylarsanız kalemler iade olarak kaydedilir; reddederseniz adetler yeniden iade edilebilir olur. Cari hesap ve limit değişmez, iade faturası ayrıca kesilir.</DialogDescription>
      </DialogHeader>
      <Table controls={false} aria-label="İade talebindeki kalemler">
        <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead className="text-right">Adet</TableHead><TableHead>Neden</TableHead></TableRow></TableHeader>
        <TableBody>{request.lines.map(line => {
          const item = lineOf.get(line.product_id);
          return <TableRow key={line.product_id}>
            <TableCell className="whitespace-normal">
              <div className="font-medium">{item?.name ?? "Siparişte bulunamadı"}</div>
              {item && <div className="text-muted-foreground">{item.code}</div>}
            </TableCell>
            <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
            <TableCell className="whitespace-normal">{returnReasonLabels[line.reason]}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      <p className="break-words text-muted-foreground">{request.note ? `Partner notu: ${request.note}` : "Partner not eklemedi."}</p>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" className="w-full sm:w-auto"/>}>Kapat</DialogClose>
        <DecisionDialog decision="reject" orderId={orderId} number={number} request={request} back={back}/>
        <DecisionDialog decision="approve" orderId={orderId} number={number} request={request} back={back}/>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
