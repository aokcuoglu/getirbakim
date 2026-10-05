"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EnrichmentVehicles } from "./enrichment-vehicles";
import { ChevronRight, X } from "lucide-react";

export function EnrichmentDetails({ name, code, productId, children, footer }: { name: string; code: string; productId: string; footer?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="enrichment-details-trigger" aria-haspopup="dialog" aria-controls={id}
      aria-label={`${code} kayıt ayrıntıları`} onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
      Ayrıntı <ChevronRight size={14}/>
    </button>
    <dialog ref={dialog} id={id} className="enrichment-details-modal" aria-labelledby={`${id}-title`}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}>
      <header className="enrichment-modal-heading"><div><p>KAYNAK VE TAKİP</p><h2 id={`${id}-title`}>{name || code}</h2><span>{code}</span></div>
        <button type="button" className="enrichment-modal-close" aria-label="Ayrıntı penceresini kapat" autoFocus onClick={() => dialog.current?.close()}><X size={20}/></button>
      </header>
      <div className="enrichment-modal-body">{children}{open && <EnrichmentVehicles productId={productId}/>} {footer}</div>
    </dialog>
  </>;
}
