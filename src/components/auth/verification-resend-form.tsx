"use client";

import { resendVerification } from "@/modules/auth/email-verification-actions";
import { EmailLinkRequestForm } from "./email-link-request-form";

/**
 * Asks for a new e-mail verification link on /e-posta-dogrula (#1258). The answer never tells whether the address waits
 * for verification; `next` is where the verified account goes.
 */
export function VerificationResendForm({ invalidLink = false, next }: { invalidLink?: boolean; next?: string }) {
  return <EmailLinkRequestForm action={resendVerification} invalidLink={invalidLink} submitLabel="Bağlantı gönder"
    intro="Kayıt olurken kullandığın e-posta adresini gir; doğrulama bağlantısını yeniden gönderelim." hidden={next ? { next } : undefined} />;
}
