"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { storeErrorBox } from "@/components/store-alert-classes";
import { cn } from "@/lib/utils";
import { verifyEmail } from "@/modules/auth/email-verification-actions";
import { initialResetState } from "@/modules/auth/reset-state";

/** Verifies the address on /e-posta-dogrula after the e-mail link (#1258); success and an unusable link redirect. */
export function VerifyEmailForm() {
  const [state, action, pending] = useActionState(verifyEmail, initialResetState);
  const errorId = `${useId()}-error`;
  const error = state.status === "error" ? state.message : "";
  return <form action={action} aria-busy={pending} aria-describedby={error ? errorId : undefined}>
    {error && <div id={errorId} className={cn(storeErrorBox, "mt-0 mb-4")} role="alert">
      <p className="m-0">{error}</p>
      <Link className="mt-2 block w-fit py-2 font-medium underline" href="/e-posta-dogrula?durum=gecersiz">Yeni bağlantı iste</Link>
    </div>}
    <Button className={cn(storeButton({ intent: "primary", size: "lg" }), "w-full disabled:cursor-wait")} type="submit" disabled={pending}>{pending ? "Doğrulanıyor…" : "E-postamı doğrula"}</Button>
  </form>;
}
