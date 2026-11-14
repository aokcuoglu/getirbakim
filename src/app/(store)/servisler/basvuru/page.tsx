import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyForService } from "@/modules/auth/service-application";
export const metadata: Metadata = { title: "Servis hesabı başvurusu | Getirbakim", robots: { index: false, follow: true } };
const field="gap-2";
const label="text-sm leading-5 font-normal";
const input="h-[52px] rounded-lg bg-white px-3.5 py-[13px] text-base leading-6 md:text-base placeholder:text-sm";

export default async function Application({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { sent, error } = normalizeSearchParams(await searchParams);
  return <section className="mx-auto min-h-[55vh] w-full max-w-[680px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
    <Link href="/servisler" className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary">← Servisler için Getirbakim</Link>
    <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Servis hesabına başvur.</h1>
    {sent === "1" ? <>
      <Alert role="status" className="rounded-md border-0 bg-[#eaf1f7] p-[15px] text-sm leading-5 text-[#50718e]">Başvurun alındı. Yeni başvurular servis bilgileri kontrol edildikten sonra değerlendirilir. Bu e-posta ile zaten bir hesabın varsa mevcut hesabını kullanabilirsin.</Alert>
      <p className="my-4">Başvurun onaylandıktan sonra belirlediğin şifreyle giriş yapabilirsin. Soruların için <a href="tel:+902163870078" className="text-primary hover:underline">0216 387 00 78</a> üzerinden bize ulaş.</p>
      <Button nativeButton={false} className="h-auto min-h-12 rounded-lg border-primary px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong" render={<Link href="/giris"/>}>Servis girişine git</Button>
    </> : <>
      <p className="text-base leading-6 text-muted-foreground">Servisini tanıyalım, parça ihtiyaçlarına birlikte bakalım. B2B fiyatları yönetici onayından sonra açılır.</p>
      {error && <Alert className="mt-4 rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]">{error === "limit" ? "Başvuru deneme sınırına ulaşıldı. Bir saat sonra tekrar dene veya destek ekibimize ulaş." : "Alanları kontrol et. Şifre en az 12 karakter ve en fazla 72 UTF-8 bayt olmalı; telefon 10–15 rakam içermeli. Kullanım koşullarını kabul et."}</Alert>}
      <form action={applyForService} className="mt-6 grid gap-5">
        <Field className={field}><FieldLabel htmlFor="application-name" className={label}>Servis adı</FieldLabel><Input id="application-name" className={input} name="name" autoComplete="organization" minLength={2} maxLength={150} required/></Field>
        <Field className={field}><FieldLabel htmlFor="application-contact" className={label}>Yetkili adı ve soyadı</FieldLabel><Input id="application-contact" className={input} name="contactName" autoComplete="name" minLength={2} maxLength={150} required/></Field>
        <Field className={field}><FieldLabel htmlFor="application-city" className={label}>İl / ilçe</FieldLabel><Input id="application-city" className={input} name="city" autoComplete="address-level2" minLength={2} maxLength={100} required/></Field>
        <Field className={field}><FieldLabel htmlFor="application-phone" className={label}>Telefon</FieldLabel><Input id="application-phone" className={input} name="phone" type="tel" autoComplete="tel" minLength={10} maxLength={25} required/></Field>
        <Field className={field}><FieldLabel htmlFor="application-email" className={label}>E-posta</FieldLabel><Input id="application-email" className={input} name="email" type="email" autoComplete="email" maxLength={200} required/></Field>
        <Field className={field}><FieldLabel htmlFor="application-password" className={label}>Şifre (en az 12 karakter)</FieldLabel><Input id="application-password" className={input} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required/></Field>
        <label className="hidden" aria-hidden="true">Web sitesi<input name="website" tabIndex={-1} autoComplete="off" defaultValue=""/></label>
        <Field orientation="horizontal" className="items-start gap-3"><Checkbox id="application-terms" name="terms" required className="mt-[5px]"/><FieldLabel htmlFor="application-terms" className="block text-sm leading-[1.8] font-normal"><Link href="/uyelik-ve-kullanim-kosullari" className="text-primary underline">Üyelik ve kullanım koşullarını</Link> okudum, kabul ediyorum.</FieldLabel></Field>
        <p className="text-sm leading-[22px] text-muted-foreground">Başvurudaki iletişim bilgilerini değerlendirme ve hesap işlemleri için kullanırız. Ayrıntılar: <Link href="/kvkk-aydinlatma-metni" className="hover:text-primary hover:underline">KVKK Aydınlatma Metni</Link> ve <Link href="/gizlilik-politikasi" className="hover:text-primary hover:underline">Gizlilik Politikası</Link>.</p>
        <Button type="submit" className="h-auto min-h-12 w-full rounded-lg px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong">Başvuruyu gönder</Button>
      </form></>}
  </section>;
}
