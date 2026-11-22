import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { passwordResetTarget, RESET_COOKIE } from "@/modules/auth/password-reset";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { ResetRequestForm } from "@/components/auth/reset-request-form";

const backLink = "mt-6 flex w-fit items-center gap-1.5 text-sm leading-5 text-primary hover:underline";

export const metadata: Metadata = { title: "Şifreni yenile", robots: privatePageRobots };

/**
 * Password reset (#1257). With a usable token in RESET_COOKIE (set by /sifre-yenile/baglanti) the page asks for the new
 * password; otherwise it asks for a new link, and explains when the link was unusable.
 */
export default async function PasswordReset({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { durum } = normalizeSearchParams(await searchParams);
  const token = (await cookies()).get(RESET_COOKIE)?.value;
  const target = token ? await passwordResetTarget(token) : null;
  const invalid = durum === "gecersiz" || Boolean(token && !target);
  return <section className="mx-auto mt-[30px] mb-5 min-h-[55vh] max-w-[440px] px-6 pt-7 pb-14 max-[600px]:pt-6 max-[600px]:pb-10">
    <p className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">GETİRBAKİM / HESABIM</p>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{target ? "Yeni şifreni belirle." : "Şifreni yenile."}</h1>
    {target
      ? <><p className="mb-6 text-base leading-6 text-muted-foreground">Yeni şifreni iki kez yaz. Şifren yenilenince tüm cihazlardaki oturumların kapanır.</p><NewPasswordForm /></>
      : <ResetRequestForm invalidLink={invalid} />}
    <Link className={backLink} href="/giris">← Giriş ekranına dön</Link>
  </section>;
}
