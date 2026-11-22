"use client";

import { useActionState, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { storeErrorBox, storeSuccessBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { requestPasswordReset } from "@/modules/auth/password-reset-actions";
import { initialResetState } from "@/modules/auth/reset-state";
import { AuthField } from "./auth-field";

const invalidLinkText = "Bu bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.";

/**
 * Asks for a password reset link (#1257); used by the auth dialog and /sifre-yenile. The answer never tells whether the
 * address has an account. `invalidLink` explains an unusable e-mail link until a new one is requested.
 */
export function ResetRequestForm({ invalidLink = false }: { invalidLink?: boolean }) {
  const [state, action, pending] = useActionState(requestPasswordReset, initialResetState);
  // The attempt whose "sent" answer was put away with "Farklı bir adres dene".
  const [dismissed, setDismissed] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const errorId = `${useId()}-error`;
  const sent = state.status === "sent" && state.attempt !== dismissed;
  const error = state.status === "error" ? state.message : "";
  const requested = state.status === "sent" || dismissed >= 0;

  function tryAnother() {
    // Render the form now and focus its address field in the same task: the clicked button is gone by then, and a
    // later focus (a frame after) loses to the auth dialog's focus manager, which moves focus lost to the body back
    // into the popup.
    flushSync(() => setDismissed(state.attempt));
    form.current?.querySelector<HTMLInputElement>("input[name=email]")?.focus();
  }

  // Keyed on the attempt: React resets the form after an action, so it remounts with the echoed address.
  return <div>
    {/* Always in the DOM, so screen readers announce the answer when it appears. */}
    <div role="status">{sent && <p className={cn(storeSuccessBox, "mt-0 mb-4")}>{state.message}</p>}</div>
    {sent
      ? <Button type="button" className={cn(storeButton({ intent: "link", size: "md" }), "px-0")} onClick={tryAnother}>Farklı bir adres dene</Button>
      : <form key={state.attempt} ref={form} action={action} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
        {invalidLink && !requested && <p className={cn(storeErrorBox, "mt-0 mb-6")} role="alert">{invalidLinkText}</p>}
        <p className="mt-0 mb-6 text-sm leading-[22px] text-muted-foreground">Hesabına kayıtlı e-posta adresini gir; şifreni yenilemen için bir bağlantı gönderelim.</p>
        <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" defaultValue={state.status === "error" ? state.email : undefined} />
        {error && <p id={errorId} className={cn(storeErrorBox, "mt-4 mb-0")} role="alert">{error}</p>}
        <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "mt-6 w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Gönderiliyor…" : "Bağlantı gönder"}</Button>
      </form>}
  </div>;
}
