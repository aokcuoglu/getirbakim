"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { cn } from "@/lib/utils";
import { AuthModal, type AuthMode } from "./auth-modal";

/** A link-style button that opens the auth dialog, on the login form unless `mode` says otherwise. */
export function LoginButton({ children, mode = "login", next, accountEmail }: { children: ReactNode; mode?: AuthMode; next?: string; accountEmail: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const modal = useRef<{ open: (mode: AuthMode) => void }>(null);
  return <>
    <Button ref={trigger} type="button" variant="link" className={cn(storeButton({ intent: "link", size: "md" }), "px-0 underline")} aria-haspopup="dialog" onClick={() => modal.current?.open(mode)}>{children}</Button>
    <AuthModal ref={modal} next={next} accountEmail={accountEmail} onClosed={() => trigger.current?.focus({ preventScroll: true })} />
  </>;
}
