import { CircleCheck, CircleX } from "lucide-react";
import { decideReturnRequest } from "@/modules/admin/commerce-actions";
import type { AdminReturnRequest } from "@/modules/admin/data";
import { returnReasonLabels } from "@/modules/store/returns";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * A partner's pending return request (#1007) on a shipped or delivered order. Approving records the lines as returns
 * (Siparişler → iade kayıtları); rejecting releases the quantity. Either way the partner sees the decision on its API.
 */
export function OrderReturnRequestDialog({ orderId, number, request, orderLines, back }: {
  orderId: string; number: string; request: AdminReturnRequest; orderLines: { product_id: string; code: string; name: string }[]; back: string;
}) {
  const lineOf = new Map(orderLines.map(line => [line.product_id, line]));
  const decision = (value: "approve" | "reject") => <>
    <input type="hidden" name="id" value={request.id}/>
    <input type="hidden" name="order" value={orderId}/>
    <input type="hidden" name="decision" value={value}/>
    <input type="hidden" name="back" value={back}/>
  </>;
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" aria-label={`#${number}: İade talebini incele`}/>}>İade talebini incele</DialogTrigger>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>#{number} — partner iade talebi</DialogTitle>
        <DialogDescription>Onaylarsanız kalemler iade olarak kaydedilir; reddederseniz adetler yeniden iade edilebilir olur. Cari hesap ve limit değişmez, iade faturası ayrıca kesilir.</DialogDescription>
      </DialogHeader>
      <Table controls={false} aria-label="İade talebindeki kalemler">
        <TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead className="text-right">Adet</TableHead><TableHead>Neden</TableHead></TableRow></TableHeader>
        <TableBody>{request.lines.map(line => {
          const item = lineOf.get(line.product_id);
          return <TableRow key={line.product_id}>
            <TableCell className="font-medium">{item?.code ?? "—"}</TableCell>
            <TableCell className="whitespace-normal">{item?.name ?? "Siparişte bulunamadı"}</TableCell>
            <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
            <TableCell>{returnReasonLabels[line.reason]}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      <p className="text-muted-foreground">{request.note ? `Partner notu: ${request.note}` : "Partner not eklemedi."}</p>
      <DialogFooter>
        <form action={decideReturnRequest}>
          {decision("reject")}
          <SubmitButton variant="outline" icon={<CircleX data-icon="inline-start" aria-hidden="true"/>}>Talebi reddet</SubmitButton>
        </form>
        <form action={decideReturnRequest}>
          {decision("approve")}
          <SubmitButton icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>}>İadeyi onayla</SubmitButton>
        </form>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
