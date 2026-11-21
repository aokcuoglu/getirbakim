"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { cn } from "@/lib/utils";
import { AuthModal, type AuthMode } from "./auth-modal";

/** A button (styled by the caller) that opens the login dialog. */
export function LoginButton({ children, className }: { children: ReactNode; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);
  return <>
    <Button ref={trigger} type="button" variant="link" className={cn(storeButton({ intent: "link", size: "md" }), "px-0", className)} aria-haspopup="dialog" onClick={() => modal.current?.open("login")}>{children}</Button>
    <AuthModal ref={modal} onClosed={() => trigger.current?.focus({ preventScroll: true })} />
  </>;
}
