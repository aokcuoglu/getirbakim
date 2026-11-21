"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Ban, CircleAlert, Undo2 } from "lucide-react";
import { setSharedImageBlock, type SharedImageBlockState } from "@/app/yonetim/ortak-gorseller/actions";
import { PendingDialogCancel } from "@/components/admin/pending-dialog-cancel";
import { SharedImageThumb } from "@/components/admin/shared-image-thumb";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * "Engelle" / "Engeli kaldır" of a shared automatic image (#1136): confirmed first, with an optional note when
 * blocking. A refused change keeps the dialog open with its message; a saved one closes it and the page refreshes.
 * Unblocking shows the image through the admin-only preview route (#1176; the store no longer serves a blocked image),
 * with the block's note and the image's source address.
 */
export function SharedImageBlockDialog({ imageId, blocked, label, note, sourceUrl }: {
  imageId: string; blocked: boolean;
  /** Names the image in the trigger's accessible name (several triggers share a table). */
  label: string;
  /** The block's note (unblock). */
  note?: string | null;
  /** The media's source address (unblock). */
  sourceUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const action = blocked ? "Engeli kaldır" : "Engelle";
  const icon = blocked ? <Undo2 data-icon="inline-start" aria-hidden="true"/> : <Ban data-icon="inline-start" aria-hidden="true"/>;
  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger render={<Button variant="outline" size="sm" aria-label={`${action}: ${label}`}/>}>{icon}{action}</AlertDialogTrigger>
    <AlertDialogContent>
      {/* Remounted on each open: the last result is not shown again. */}
      {open && <BlockForm imageId={imageId} blocked={blocked} action={action} icon={icon} blockNote={note ?? null} sourceUrl={sourceUrl ?? null} onSaved={() => setOpen(false)}/>}
    </AlertDialogContent>
  </AlertDialog>;
}

function BlockForm({ imageId, blocked, action, icon, blockNote, sourceUrl, onSaved }: {
  imageId: string; blocked: boolean; action: string; icon: ReactNode; blockNote: string | null; sourceUrl: string | null; onSaved: () => void;
}) {
  const id = useId();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear the note.
  const [note, setNote] = useState("");
  const [result, submit] = useActionState(async (previous: SharedImageBlockState, form: FormData) => {
    const next = await setSharedImageBlock(previous, form);
    if (next.status === "success") onSaved();
    return next;
  }, { status: "idle" });

  return <form action={submit} className="contents">
    <input type="hidden" name="imageId" value={imageId}/>
    <input type="hidden" name="blocked" value={blocked ? "0" : "1"}/>
    <AlertDialogHeader>
      <AlertDialogTitle>{blocked ? "Görselin engeli kaldırılsın mı?" : "Görsel engellensin mi?"}</AlertDialogTitle>
      <AlertDialogDescription>{blocked
        ? "Görsel, kullanan ürünlerde mağazada yeniden gösterilir. Yöneticinin gizlediği otomatik görseller gizli kalır."
        : "Bu görsel mağazada, ürün görsellerinde ve ürün akışında gizlenir. Yönetici yüklemeleri etkilenmez."}</AlertDialogDescription>
    </AlertDialogHeader>
    {blocked && <div className="flex min-w-0 flex-wrap items-start gap-4">
      <SharedImageThumb imageId={imageId} blocked shown={false} size="lg" alt="Engeli kaldırılacak görsel"/>
      <dl className="grid min-w-0 flex-1 basis-56 gap-2">
        <div className="min-w-0"><dt className="text-muted-foreground">Engel notu</dt><dd className="break-words">{blockNote || "Not yok"}</dd></div>
        {sourceUrl && <div className="min-w-0"><dt className="text-muted-foreground">Kaynak adresi</dt>
          <dd className="truncate"><a className="underline-offset-4 hover:underline" href={sourceUrl} target="_blank" rel="noreferrer" title={sourceUrl}>{sourceUrl}<span className="sr-only"> (yeni sekmede açılır)</span></a></dd></div>}
      </dl>
    </div>}
    {!blocked && <Field>
      <FieldLabel htmlFor={`${id}-note`}>Not (isteğe bağlı)</FieldLabel>
      <Input id={`${id}-note`} name="note" maxLength={200} autoComplete="off" value={note} onChange={event => setNote(event.currentTarget.value)}
        aria-describedby={`${id}-note-hint`}/>
      <FieldDescription id={`${id}-note-hint`}>Engellenen görseller listesinde görünür (en çok 200 karakter).</FieldDescription>
    </Field>}
    {result.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <AlertDialogFooter>
      <PendingDialogCancel>Vazgeç</PendingDialogCancel>
      <SubmitButton variant={blocked ? "default" : "destructive"} pendingLabel="Kaydediliyor…" icon={icon}>{action}</SubmitButton>
    </AlertDialogFooter>
  </form>;
}
