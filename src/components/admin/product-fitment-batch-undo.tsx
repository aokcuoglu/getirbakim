"use client";

import { useState } from "react";
import { CircleAlert, Undo2 } from "lucide-react";
import { undoProductFitmentBatch } from "@/app/yonetim/urunler/fitment-actions";
import { formatNumber } from "@/modules/admin/format";
import { useFitmentChange } from "@/components/admin/use-fitment-change";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * "Geri al" of a bulk fitment add or copy in the product history (#817): asks first, then takes the batch's types
 * still added back in one step. The refreshed history shows the undo as its own line. A refused undo (a stale tab
 * whose batch is already taken back, #869) keeps the dialog open with its message; closing it refreshes the history.
 */
export function ProductFitmentBatchUndo({ productId, batchId, count }: { productId: string; batchId: string; count: number }) {
  const { pending, result, setResult, mutate, refresh } = useFitmentChange({ refreshOnError: false });
  const [open, setOpen] = useState(false);
  const error = result?.status === "error" ? result.message : null;

  return <AlertDialog open={open} onOpenChange={next => {
    if (pending) return;
    setOpen(next);
    if (next) return;
    // The refused row may be stale: the history reloads once the message has been read.
    if (error) refresh();
    setResult(null);
  }}>
    <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" aria-label={`Toplu işlemi geri al: ${formatNumber(count)} araç tipi`}/>}>
      <Undo2 data-icon="inline-start" aria-hidden="true"/>Geri al
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Toplu işlem geri alınsın mı?</AlertDialogTitle>
        <AlertDialogDescription>
          Bu işlemle eklenen {formatNumber(count)} araç tipi üründen kaldırılacak. Sonradan tek tek kaldırdığınız veya mağazadan çıkardığınız tipler etkilenmez; otomatik kaynakta da bulunan tipler otomatik uyum olarak kalır.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{error}</AlertDescription></Alert>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{error ? "Kapat" : "Vazgeç"}</AlertDialogCancel>
        <AlertDialogAction type="button" variant="destructive" disabled={pending}
          onClick={() => mutate(() => undoProductFitmentBatch({ productId, batchId }), () => setOpen(false))}>
          {pending ? <><Spinner data-icon="inline-start"/>Geri alınıyor…</> : <><Undo2 data-icon="inline-start" aria-hidden="true"/>Geri al</>}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
