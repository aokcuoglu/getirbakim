"use client";

import { useRef, type ReactNode } from "react";
import { AuthModal, type AuthMode } from "./auth-modal";

/** A button (styled by the caller) that opens the login dialog. */
export function LoginButton({ children, className }: { children: ReactNode; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);
  return <>
    <button ref={trigger} type="button" className={className} aria-haspopup="dialog" onClick={() => modal.current?.open("login")}>{children}</button>
    <AuthModal ref={modal} onClosed={() => trigger.current?.focus({ preventScroll: true })} />
  </>;
}
