"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { storeErrorBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { resetPassword } from "@/modules/auth/password-reset-actions";
import { initialResetState } from "@/modules/auth/reset-state";
import { AuthField } from "./auth-field";

/** Sets the new password on /sifre-yenile after the e-mail link (#1257); success and an unusable link redirect. */
export function NewPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, initialResetState);
  const errorId = `${useId()}-error`;
  const error = state.status === "error" ? state.message : "";
  return <form action={action} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
    <div className="grid gap-3">
      <AuthField name="newPassword" label="Yeni şifre (en az 12 karakter)" type="password" autoComplete="new-password" />
      <AuthField name="confirmPassword" label="Yeni şifre tekrar" type="password" autoComplete="new-password" />
    </div>
    {error && <p id={errorId} className={cn(storeErrorBox, "mt-4 mb-0")} role="alert">{error}</p>}
    <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "mt-6 w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Kaydediliyor…" : "Şifremi yenile"}</Button>
  </form>;
}
