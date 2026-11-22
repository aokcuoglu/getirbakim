"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { storeErrorBox, storeSuccessBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { initialResetState, type ResetState } from "@/modules/auth/reset-state";
import { AuthField } from "./auth-field";

const defaultInvalidLinkText = "Bu bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.";

type Props = {
  action: (prev: ResetState, form: FormData) => Promise<ResetState>;
  intro: string;
  submitLabel: string;
  /** Explains an unusable e-mail link while `invalidLink`, until a new link is requested. */
  invalidLinkText?: string;
  invalidLink?: boolean;
  /** Hidden fields sent with the address, e.g. the return path. */
  hidden?: Record<string, string>;
};

/**
 * Asks for an e-mailed link by address: password reset (#1257) and e-mail verification (#1258). The answer never tells
 * whether the address has an account.
 */
export function EmailLinkRequestForm({ action: requestLink, intro, submitLabel, invalidLinkText = defaultInvalidLinkText, invalidLink = false, hidden = {} }: Props) {
  const [state, action, pending] = useActionState(requestLink, initialResetState);
  // The attempt whose "sent" answer was put away with "Farklı bir adres dene".
  const [dismissed, setDismissed] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const errorId = `${useId()}-error`;
  const sent = state.status === "sent" && state.attempt !== dismissed;
  const error = state.status === "error" ? state.message : "";
  const requested = state.status === "sent" || dismissed >= 0;
  const status = useRef<HTMLParagraphElement>(null);
  // The submit button is gone with the form: move focus to the answer so keyboard and screen-reader users land on it.
  useEffect(() => { if (sent) status.current?.focus(); }, [sent, state.attempt]);

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
    <div role="status">{sent && <p ref={status} tabIndex={-1} className={cn(storeSuccessBox, "mt-0 mb-4 outline-none")}>{state.message}</p>}</div>
    {sent
      ? <Button type="button" className={cn(storeButton({ intent: "link", size: "md" }), "px-0")} onClick={tryAnother}>Farklı bir adres dene</Button>
      : <form key={state.attempt} ref={form} action={action} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {invalidLink && !requested && <p className={cn(storeErrorBox, "mt-0 mb-6")} role="alert">{invalidLinkText}</p>}
        <p className="mt-0 mb-6 text-sm leading-[22px] text-muted-foreground">{intro}</p>
        <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" defaultValue={state.status === "error" ? state.email : undefined} />
        {error && <p id={errorId} className={cn(storeErrorBox, "mt-4 mb-0")} role="alert">{error}</p>}
        <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "mt-6 w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Gönderiliyor…" : submitLabel}</Button>
      </form>}
  </div>;
}
