"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AuthModal, type AuthMode } from "./auth-modal";

export function LoginButton({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);

  useEffect(() => {
    if (open) modal.current?.open("login");
  }, [open]);

  return <>
    <button ref={trigger} type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>{children}</button>
    {open && createPortal(<AuthModal ref={modal} onClosed={() => {
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }} />, document.body)}
  </>;
}
