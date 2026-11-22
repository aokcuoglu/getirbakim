"use client";

import { requestPasswordReset } from "@/modules/auth/password-reset-actions";
import { EmailLinkRequestForm } from "./email-link-request-form";

/**
 * Asks for a password reset link (#1257); used by the auth dialog and /sifre-yenile. The answer never tells whether the
 * address has an account. `invalidLink` explains an unusable e-mail link until a new one is requested.
 */
export function ResetRequestForm({ invalidLink = false }: { invalidLink?: boolean }) {
  return <EmailLinkRequestForm action={requestPasswordReset} invalidLink={invalidLink} submitLabel="Bağlantı gönder"
    intro="Hesabına kayıtlı e-posta adresini gir; şifreni yenilemen için bir bağlantı gönderelim." />;
}
