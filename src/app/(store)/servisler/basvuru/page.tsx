import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { storeErrorBox } from "@/components/store-alert-classes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { applyForService, applyForServiceUpgrade } from "@/modules/auth/service-application";
import { loginPath } from "@/modules/auth/return-to";
import { currentAccount, type Account } from "@/modules/auth/session";
import { serviceUpgradePending } from "@/modules/auth/service-upgrade";
import { storeButton } from "@/components/store-button";
import { cn } from "@/lib/utils";
export const metadata: Metadata = { title: "Servis hesabı başvurusu", robots: privatePageRobots };
const field="gap-2";
const label="text-sm leading-5 font-normal";
const input="h-[52px] rounded-lg bg-white px-3.5 py-[13px] text-base leading-6 md:text-base placeholder:text-sm";
const statusBox="rounded-md border-0 bg-[#eaf1f7] p-[15px] text-sm leading-5 text-[#50718e]";
const primaryButton=storeButton({ intent: "primary", size: "lg" });
const limitMessage="Başvuru deneme sınırına ulaşıldı. Bir saat sonra tekrar dene veya destek ekibimize ulaş.";
const contactLine=<>Soruların için <a href="tel:+902163870078" className="text-primary hover:underline">0216 387 00 78</a> üzerinden bize ulaş.</>;

/** The service details both forms ask for; `children` (the guest's login fields) go between them and the consent. */
function ApplicationFields({ contactName, children }: { contactName?: string; children?: ReactNode }) {
  return <>
    <Field className={field}><FieldLabel htmlFor="application-name" className={label}>Servis adı</FieldLabel><Input id="application-name" className={input} name="name" autoComplete="organization" minLength={2} maxLength={150} required/></Field>
    <Field className={field}><FieldLabel htmlFor="application-contact" className={label}>Yetkili adı ve soyadı</FieldLabel><Input id="application-contact" className={input} name="contactName" autoComplete="name" minLength={2} maxLength={150} defaultValue={contactName} required/></Field>
    <Field className={field}><FieldLabel htmlFor="application-city" className={label}>İl / ilçe</FieldLabel><Input id="application-city" className={input} name="city" autoComplete="address-level2" minLength={2} maxLength={100} required/></Field>
    <Field className={field}><FieldLabel htmlFor="application-phone" className={label}>Telefon</FieldLabel><Input id="application-phone" className={input} name="phone" type="tel" autoComplete="tel" minLength={10} maxLength={25} required/></Field>
    {children}
    <Field orientation="horizontal" className="items-start gap-3"><Checkbox id="application-terms" name="terms" required className="mt-[5px]"/><FieldLabel htmlFor="application-terms" className="block text-sm leading-[1.8] font-normal"><Link href="/uyelik-ve-kullanim-kosullari" className="text-primary underline">Üyelik ve kullanım koşullarını</Link> okudum, kabul ediyorum.</FieldLabel></Field>
    <p className="text-sm leading-[22px] text-muted-foreground">Başvurudaki iletişim bilgilerini değerlendirme ve hesap işlemleri için kullanırız. Ayrıntılar: <Link href="/kvkk-aydinlatma-metni" className="hover:text-primary hover:underline">KVKK Aydınlatma Metni</Link> ve <Link href="/gizlilik-politikasi" className="hover:text-primary hover:underline">Gizlilik Politikası</Link>.</p>
    <Button type="submit" className={cn(primaryButton, "w-full")}>Başvuruyu gönder</Button>
  </>;
}

/** Signed-in content: the upgrade form or its status for a customer (#1259), a short note for a service or an admin. */
async function SignedIn({ account, error }: { account: Account; error?: string }) {
  if (account.role === "admin") return <>
    <p className="mb-6 text-base leading-6 text-muted-foreground">Yönetici hesabıyla servis başvurusu yapılamaz.</p>
    <Button nativeButton={false} className={primaryButton} render={<Link href="/yonetim"/>}>Yönetim paneli</Button>
  </>;
  if (account.role === "service") return <>
    <p className="mb-6 text-base leading-6 text-muted-foreground">Zaten onaylı bir servis hesabın var. B2B fiyatların katalogda görünür.</p>
    <Button nativeButton={false} className={primaryButton} render={<Link href="/katalog"/>}>Kataloğa git</Button>
  </>;
  if (await serviceUpgradePending(account.id)) return <>
    <Alert role="status" className={statusBox}>Servis başvurun değerlendiriliyor. Onaylandığında bu hesap servis hesabına dönüşür ve B2B fiyatların açılır; o zamana kadar alışverişe aynı hesapla devam edebilirsin.</Alert>
    <p className="my-4">{contactLine}</p>
    <Button nativeButton={false} className={primaryButton} render={<Link href="/katalog"/>}>Alışverişe devam et</Button>
  </>;
  return <>
    <p className="text-base leading-6 text-muted-foreground">Mevcut hesabınla başvuruyorsun; e-posta ve şifren değişmez. Başvurun değerlendirilirken alışverişe liste fiyatlarıyla devam edebilirsin.</p>
    <p className="mt-2 text-sm leading-5 wrap-anywhere text-muted-foreground">Hesap: {account.email}</p>
    {error && <Alert className={cn(storeErrorBox, "mt-4")}>{error === "limit" ? limitMessage : "Alanları kontrol et. Telefon 10–15 rakam içermeli; kullanım koşullarını kabul et."}</Alert>}
    <form action={applyForServiceUpgrade} className="mt-6 grid gap-5"><ApplicationFields contactName={account.name}/></form>
  </>;
}

export default async function Application({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ sent, error }, current] = await Promise.all([searchParams.then(normalizeSearchParams), currentAccount()]);
  // A session of a deactivated account gets the guest form, whose action answers it like any taken address.
  const account = current?.approved ? current : null;
  return <section className="mx-auto min-h-[55vh] w-full max-w-[680px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
    <Link href="/servisler" className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary">← Servisler için Getirbakim</Link>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Servis hesabına başvur.</h1>
    {account ? <SignedIn account={account} error={error}/> : sent === "1" ? <>
      <Alert role="status" className={statusBox}>Başvurun alındı. Yeni başvurular servis bilgileri kontrol edildikten sonra değerlendirilir.</Alert>
      <p className="my-4">Başvurun onaylandıktan sonra belirlediğin şifreyle giriş yapabilirsin. {contactLine}</p>
      <Button nativeButton={false} className={primaryButton} render={<Link href="/giris"/>}>Servis girişine git</Button>
    </> : <>
      <p className="text-base leading-6 text-muted-foreground">Servisini tanıyalım, parça ihtiyaçlarına birlikte bakalım. B2B fiyatları yönetici onayından sonra açılır.</p>
      {error && <Alert className={cn(storeErrorBox, "mt-4")}>{error === "limit" ? limitMessage : error === "account"
        ? <>Bu e-posta adresiyle bir bireysel hesabın var. Önce giriş yap, sonra servis başvurunu hesabından gönder; siparişlerin ve şifren aynı kalır. <Link href={loginPath("/servisler/basvuru")} className="font-medium underline">Giriş yap</Link></>
        : "Alanları kontrol et. Şifre en az 12 karakter ve en fazla 72 UTF-8 bayt olmalı; telefon 10–15 rakam içermeli. Kullanım koşullarını kabul et."}</Alert>}
      <form action={applyForService} className="mt-6 grid gap-5">
        <ApplicationFields>
          <Field className={field}><FieldLabel htmlFor="application-email" className={label}>E-posta</FieldLabel><Input id="application-email" className={input} name="email" type="email" autoComplete="email" maxLength={200} required/></Field>
          <Field className={field}><FieldLabel htmlFor="application-password" className={label}>Şifre (en az 12 karakter)</FieldLabel><Input id="application-password" className={input} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required/></Field>
          <label className="hidden" aria-hidden="true">Web sitesi<input name="website" tabIndex={-1} autoComplete="off" defaultValue=""/></label>
        </ApplicationFields>
      </form></>}
  </section>;
}
