"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { storeErrorBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { requestPasswordReset } from "@/modules/auth/password-reset-actions";
import { initialResetState } from "@/modules/auth/reset-state";
import { AuthField } from "./auth-field";

/** Asks for a password reset link (#1257); used by the auth dialog and /sifre-yenile. The answer never tells whether the address has an account. */
export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialResetState);
  const errorId = `${useId()}-error`;
  if (state.status === "sent") return <p className="mt-0 mb-4 rounded-md border border-[#c9dfef] bg-[#f0f6fb] p-3 text-[13px] leading-5" role="status">{state.message}</p>;
  const error = state.status === "error" ? state.message : "";
  return <form action={action} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
    <p className="mt-0 mb-6 text-sm leading-[22px] text-muted-foreground">Hesabına kayıtlı e-posta adresini gir; şifreni yenilemen için bir bağlantı gönderelim.</p>
    <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" />
    {error && <p id={errorId} className={cn(storeErrorBox, "mt-4 mb-0")} role="alert">{error}</p>}
    <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "mt-6 w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Gönderiliyor…" : "Bağlantı gönder"}</Button>
  </form>;
}
