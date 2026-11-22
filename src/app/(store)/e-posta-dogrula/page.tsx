import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { accountEmailEnabled } from "@/modules/auth/account-email-switch";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { emailVerificationTarget, originHashOf, VERIFY_COOKIE, VERIFY_ORIGIN_COOKIE } from "@/modules/auth/email-verification";
import { unverifiedKeepPeriod } from "@/modules/auth/verification-policy";
import { safeReturnTo } from "@/modules/auth/return-to";
import { VerificationResendForm } from "@/components/auth/verification-resend-form";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

const backLink = "mt-6 flex w-fit items-center gap-1.5 text-sm leading-5 text-primary hover:underline";

export const metadata: Metadata = { title: "E-postanı doğrula", robots: privatePageRobots };

/**
 * E-mail verification (#1258). With a usable token in VERIFY_COOKIE (set by /e-posta-dogrula/baglanti) the page asks to
 * confirm; otherwise it offers a new link, and explains when the link was unusable.
 */
export default async function EmailVerification({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!accountEmailEnabled()) notFound();
  const { durum, next } = normalizeSearchParams(await searchParams);
  const jar = await cookies();
  const token = jar.get(VERIFY_COOKIE)?.value, nonce = jar.get(VERIFY_ORIGIN_COOKIE)?.value;
  const target = token ? await emailVerificationTarget(token, nonce ? originHashOf(nonce) : null) : null;
  const invalid = durum === "gecersiz" || Boolean(token && !target);
  return <section className="mx-auto mt-[30px] mb-5 min-h-[55vh] max-w-[440px] px-6 pt-7 pb-14 max-[600px]:pt-6 max-[600px]:pb-10">
    <p className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">GETİRBAKİM / HESABIM</p>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{target ? "E-postanı doğrula." : "Doğrulama bağlantısını yeniden gönder."}</h1>
    {target
      ? <><p className="mb-6 text-base leading-6 text-muted-foreground">Hesabını açmak için e-posta adresini doğrula.{target.sameBrowser ? "" : " Kaydı başka bir tarayıcıda yaptığın için doğruladıktan sonra yeni bir şifre belirlemen istenecek."} Kaydı sen yapmadıysan bu sayfayı kapat; doğrulanmayan kayıt {unverifiedKeepPeriod} içinde silinir.</p><VerifyEmailForm /></>
      : <VerificationResendForm invalidLink={invalid} next={safeReturnTo(next) ?? undefined} />}
    <Link className={backLink} href="/giris">← Giriş ekranına dön</Link>
  </section>;
}
