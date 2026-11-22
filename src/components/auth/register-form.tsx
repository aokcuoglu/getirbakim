"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { checkoutCheckbox } from "@/components/checkout-field-classes";
import { storeButton } from "@/components/store-button";
import { storeErrorBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { registerCustomer } from "@/modules/auth/customer-signup";
import { initialSignupState } from "@/modules/auth/signup-state";
import { AuthField } from "./auth-field";

const legalLink = "font-medium text-brand hover:text-brand-strong hover:underline";

/**
 * Individual customer signup inside the auth dialog (#1254): logs the new account in and returns to `next`, or to the
 * page the dialog was opened on. Service accounts still apply through /servisler/basvuru.
 */
export function RegisterForm({ next, onNavigate }: { next?: string; onNavigate: () => void }) {
  const [state, action, pending] = useActionState(registerCustomer, initialSignupState);
  // Rendered only inside the opened dialog, never on the server, so the current address is at hand.
  const [returnTo] = useState(() => next ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search));
  return <form action={action} aria-busy={pending}>
    <input type="hidden" name="next" value={returnTo} />
    <div className="grid gap-3">
      <AuthField name="name" label="Ad soyad" autoComplete="name" />
      <AuthField name="email" label="E-posta adresi" type="email" autoComplete="email" />
      <AuthField name="newPassword" label="Şifre (en az 12 karakter)" type="password" autoComplete="new-password" />
      <AuthField name="confirmPassword" label="Şifre tekrar" type="password" autoComplete="new-password" />
    </div>
    <div className="absolute size-px overflow-hidden [clip-path:inset(50%)]" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <label className="mt-4 flex items-start gap-2.5 text-sm leading-5">
      <Checkbox name="terms" value="on" required className={checkoutCheckbox} />
      <span><Link className={legalLink} href="/uyelik-ve-kullanim-kosullari" onClick={onNavigate}>Üyelik ve Kullanım Koşulları</Link>&apos;nı okudum, kabul ediyorum.</span>
    </label>
    <p className="mt-2 mb-0 text-[13px] leading-5 text-muted-foreground">Kişisel verilerin <Link className={legalLink} href="/kvkk-aydinlatma-metni" onClick={onNavigate}>KVKK Aydınlatma Metni</Link> kapsamında işlenir.</p>
    {state.status === "error" && <p className={cn(storeErrorBox, "mt-4 mb-0")} role="alert">{state.message}</p>}
    <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "mt-6 w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Hesap oluşturuluyor…" : "Kayıt ol"}</Button>
    <p className="mt-4 mb-0 text-center text-sm leading-[22px] text-muted-foreground">Servis misin? <Link className={legalLink} href="/servisler/basvuru" onClick={onNavigate}>Servis hesabına başvur</Link></p>
  </form>;
}
