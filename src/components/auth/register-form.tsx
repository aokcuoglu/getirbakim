"use client";

import Link from "next/link";
import { useActionState, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { checkoutCheckbox } from "@/components/checkout-field-classes";
import { storeButton } from "@/components/store-button";
import { storeErrorBox, storeSuccessBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { registerCustomer } from "@/modules/auth/customer-signup";
import { membershipConsentText } from "@/modules/auth/membership-consent";
import { initialSignupState } from "@/modules/auth/signup-state";
import { AuthField } from "./auth-field";
import { currentReturnTarget } from "./return-target";

const legalLink = "font-medium text-brand hover:text-brand-strong hover:underline";
const termsMissing = "Devam etmek için Üyelik ve Kullanım Koşulları'nı kabul et.";

/**
 * Individual customer signup inside the auth dialog (#1254). The account opens when its address is verified by the
 * mailed link (#1258), which returns to `next`, or to the page the dialog was opened on. Service accounts still apply
 * through /servisler/basvuru.
 */
export function RegisterForm({ next, onNavigate }: { next?: string; onNavigate: () => void }) {
  const [state, action, pending] = useActionState(registerCustomer, initialSignupState);
  // Rendered only inside the opened dialog, never on the server, so the current address is at hand.
  const [returnTo] = useState(() => currentReturnTarget(next));
  const [termsError, setTermsError] = useState(false);
  const id = useId(), termsId = `${id}-terms`, errorId = `${id}-error`;
  const error = termsError ? termsMissing : state.status === "error" ? state.message : "";
  // The attempt whose "sent" answer was put away with "Farklı bir adres dene".
  const [dismissed, setDismissed] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const sent = state.status === "sent" && state.attempt !== dismissed;
  const resendHref = returnTo && returnTo !== "/" ? `/e-posta-dogrula?${new URLSearchParams({ next: returnTo })}` : "/e-posta-dogrula";

  function tryAnother() {
    // Render the form now and focus its address field in the same task, before the dialog's focus manager reclaims the
    // focus lost with the clicked button (see EmailLinkRequestForm).
    flushSync(() => setDismissed(state.attempt));
    form.current?.querySelector<HTMLInputElement>("input[name=email]")?.focus();
  }

  // The consent box's input is hidden, so a native "required" would block the submit without showing why.
  function checkTerms(event: FormEvent<HTMLFormElement>) {
    const accepted = new FormData(event.currentTarget).get("terms") === "on";
    setTermsError(!accepted);
    if (!accepted) event.preventDefault();
  }

  // Keyed on the attempt: React resets the form after an action, so it remounts with the echoed name, email and consent.
  return <div>
    {/* Always in the DOM, so screen readers announce the answer when it appears. */}
    <div role="status">{sent && <div className={cn(storeSuccessBox, "mt-0 mb-4")}>
      <p className="m-0 font-semibold">E-postanı kontrol et</p>
      <p className="mt-1 mb-0 wrap-anywhere">{state.values?.email} adresine bir doğrulama bağlantısı gönderdik. Hesabın, bağlantıyı açıp e-posta adresini doğruladığında açılır. Bağlantı 24 saat geçerlidir; gelen kutunu ve spam klasörünü kontrol et.</p>
    </div>}</div>
    {sent ? <div className="flex flex-col items-start gap-2">
      <Button type="button" className={cn(storeButton({ intent: "link", size: "md" }), "px-0")} onClick={tryAnother}>Farklı bir adres dene</Button>
      <Link className={legalLink} href={resendHref} onClick={onNavigate}>Doğrulama e-postasını yeniden gönder</Link>
    </div> : <form key={state.attempt} ref={form} action={action} onSubmit={checkTerms} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
    <input type="hidden" name="next" value={returnTo} />
    <div className="grid gap-3">
      <AuthField name="name" label="Ad soyad" autoComplete="name" defaultValue={state.values?.name} />
      <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" defaultValue={state.values?.email} />
      <AuthField name="newPassword" label="Şifre (en az 12 karakter)" type="password" autoComplete="new-password" />
      <AuthField name="confirmPassword" label="Şifre tekrar" type="password" autoComplete="new-password" />
    </div>
    <div className="absolute size-px overflow-hidden [clip-path:inset(50%)]" aria-hidden="true" inert><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <div className="mt-4 flex items-start gap-2.5 text-sm leading-5">
      <Checkbox id={termsId} name="terms" value="on" defaultChecked={state.values?.terms} aria-required="true" aria-invalid={termsError || undefined}
        onCheckedChange={checked => { if (checked) setTermsError(false); }} className={checkoutCheckbox} />
      <label htmlFor={termsId}>{membershipConsentText}</label>
    </div>
    <p className="mt-2 mb-0 text-[13px] leading-5 text-muted-foreground"><Link className={legalLink} href="/uyelik-ve-kullanim-kosullari" onClick={onNavigate}>Üyelik ve Kullanım Koşulları</Link> · Kişisel verilerin <Link className={legalLink} href="/kvkk-aydinlatma-metni" onClick={onNavigate}>KVKK Aydınlatma Metni</Link> kapsamında işlenir.</p>
    {error && <p id={errorId} className={cn(storeErrorBox, "mt-4 mb-0")} role="alert">{error}</p>}
    <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "mt-6 w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Gönderiliyor…" : "Kayıt ol"}</Button>
    <p className="mt-4 mb-0 text-center text-sm leading-[22px] text-muted-foreground">Servis misin? <Link className={legalLink} href="/servisler/basvuru" onClick={onNavigate}>Servis hesabına başvur</Link></p>
  </form>}
  </div>;
}
