"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CircleAlert, Clock, Save } from "lucide-react";
import { saveLineProcurement, type ProcurementResult } from "@/modules/admin/commerce-actions";
import {
  lineFigures, lineScope, needsProcurement, procurementLabel, procurementStatuses, procurementSummary, supplierItemHref,
  type AdminOrderLine, type ProcurementStatus,
} from "@/modules/admin/order-procurement";
import { formatDateTime } from "@/modules/admin/format";
import { money } from "@/modules/store/money";
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type OrderLineView = AdminOrderLine & { supplier_label: string };

const time = (value: string) => formatDateTime(value, { year: true });
const procurementTone: Record<ProcurementStatus, StatusTone> = { pending: "warning", ordered: "info", procured: "success" };

function ProcurementSummaryBadge({ lines, active }: { lines: OrderLineView[]; active: boolean }) {
  const summary = procurementSummary(lines);
  // Orders past procurement (shipped, delivered, cancelled, unpaid) had no tracking before #606: no pending badge.
  const recorded = summary.ordered + summary.procured > 0;
  if (!active && !recorded) return <StatusBadge tone="neutral">Kalemler ({lines.length})</StatusBadge>;
  if (summary.needed === 0) return <StatusBadge tone="neutral">Mağaza stoku</StatusBadge>;
  if (summary.pending > 0) return <StatusBadge tone="warning" icon={Clock}>Tedarik bekliyor {summary.pending}/{summary.needed}</StatusBadge>;
  if (summary.ordered > 0) return <StatusBadge tone="info">Sipariş verildi {summary.ordered}/{summary.needed}</StatusBadge>;
  return <StatusBadge tone="success">Tedarik edildi</StatusBadge>;
}

function LineProcurementBadge({ line }: { line: OrderLineView }) {
  if (!needsProcurement(line)) return <StatusBadge tone="neutral">Mağaza stoku</StatusBadge>;
  const status = line.procurement_status;
  return <StatusBadge tone={procurementTone[status]} icon={status === "pending" ? Clock : undefined}>{procurementLabel[status]}</StatusBadge>;
}

/** Order lines with supplier, warehouse, cost and procurement status (#606); admin only. */
export function OrderLinesDialog({ number, orderId, orderStatus, editable, lines }: {
  number: string; orderId: string; orderStatus: string; editable: boolean; lines: OrderLineView[];
}) {
  const active = ["pending", "confirmed"].includes(orderStatus);
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`#${number} kalemleri ve tedarik`}/>}>
      <ProcurementSummaryBadge lines={lines} active={active}/>
    </DialogTrigger>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>#{number} kalemleri ve tedarik</DialogTitle>
        <DialogDescription>Maliyet KDV hariç, satış KDV dahil birim fiyattır. Müşteri bu bilgileri görmez.</DialogDescription>
      </DialogHeader>
      <Table controls={false}>
        <TableHeader><TableRow>
          <TableHead>Ürün</TableHead><TableHead>Tedarikçi</TableHead><TableHead className="text-right">Adet</TableHead>
          <TableHead className="text-right">Birim maliyet</TableHead><TableHead className="text-right">Satış</TableHead><TableHead>Tedarik</TableHead>
          {editable && <TableHead>İşlem</TableHead>}
        </TableRow></TableHeader>
        <TableBody>{lines.map(line => {
          const unit = Number(line.unit_price_kurus);
          const figures = lineFigures(line.pricing_snapshot, unit);
          const scope = lineScope(line.pricing_snapshot);
          const supplierHref = line.supplier_item ? supplierItemHref(line.supplier, line.product_id) : null;
          const scopeText = [scope.company, scope.listGroup, scope.warehouse].filter(Boolean).join(" · ");
          const procurementTime = line.procured_at ?? line.procurement_ordered_at;
          return <TableRow key={line.product_id} className="align-top">
            <TableCell className="min-w-56 whitespace-normal">
              <div className="font-medium">{line.name}</div>
              <div className="font-mono text-muted-foreground">{line.code}</div>
              <div className="flex flex-wrap gap-2">
                {supplierHref && <Button variant="link" size="sm" nativeButton={false} render={<Link href={supplierHref}/>}>Tedarikçi ürünü</Button>}
                {line.master_id && <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/yonetim/urunler/${line.master_id}`}/>}>Ürün kartı</Button>}
              </div>
            </TableCell>
            <TableCell className="whitespace-normal">
              <div>{line.supplier_label}</div>
              {scopeText && <div className="text-muted-foreground">{scopeText}</div>}
              {scope.checkoutMode === "snapshot" && <StatusBadge tone="warning">Kayıtlı veri</StatusBadge>}
              {scope.observedAt && <div className="text-muted-foreground">Veri: {time(scope.observedAt)}</div>}
            </TableCell>
            <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
            <TableCell className="text-right tabular-nums">{figures.costKurus !== null ? money(figures.costKurus) : "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              <div>{money(unit)}</div>
              {figures.marginKurus !== null && (figures.marginKurus < 0
                ? <div className="text-destructive">Zarar {money(-figures.marginKurus)}</div>
                : <div className="text-muted-foreground">Kâr {money(figures.marginKurus)}</div>)}
            </TableCell>
            <TableCell className="whitespace-normal">
              <LineProcurementBadge line={line}/>
              {line.procurement_ref && <div className="break-all">{line.procurement_ref}</div>}
              {procurementTime && <div className="text-muted-foreground">{time(procurementTime)}</div>}
            </TableCell>
            {editable && <TableCell>
              {needsProcurement(line)
                ? <LineProcurementForm key={line.procurement_status + (line.procurement_ref ?? "")} orderId={orderId} line={line}/>
                : <span className="text-muted-foreground">Gerekmiyor</span>}
            </TableCell>}
          </TableRow>;
        })}</TableBody>
      </Table>
    </DialogContent>
  </Dialog>;
}

function LineProcurementForm({ orderId, line }: { orderId: string; line: OrderLineView }) {
  const [result, action] = useActionState(saveLineProcurement, { status: "idle" } satisfies ProcurementResult);
  return <form action={action} className="flex flex-col gap-2">
    <input type="hidden" name="order" value={orderId}/>
    <input type="hidden" name="product" value={line.product_id}/>
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect name="status" defaultValue={line.procurement_status} aria-label={`${line.code} tedarik durumu`}>
        {procurementStatuses.map(status => <NativeSelectOption key={status} value={status}>{procurementLabel[status]}</NativeSelectOption>)}
      </NativeSelect>
      <Input name="reference" className="w-44" defaultValue={line.procurement_ref ?? ""} placeholder="Tedarikçi sipariş no / not" maxLength={200}
        aria-label={`${line.code} tedarik referansı`}/>
      <SubmitButton variant="outline" pendingLabel="Kaydediliyor…" icon={<Save data-icon="inline-start" aria-hidden="true"/>}>Kaydet</SubmitButton>
    </div>
    {result.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
  </form>;
}
