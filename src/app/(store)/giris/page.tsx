import type { Metadata } from "next";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import { login } from "@/modules/auth/actions";
import { accountEmailEnabled } from "@/modules/auth/account-email-switch";
import { safeReturnTo, verificationResendPath } from "@/modules/auth/return-to";
import { Alert } from "@/components/ui/alert";
import { storeErrorBox, storeSuccessBox } from "@/components/store-alert-classes";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { catalogPath } from "@/modules/seo/paths";
import { storeButton } from "@/components/store-button";
import { LoginButton } from "@/components/auth/login-button";
import { cn } from "@/lib/utils";

const field="gap-2";
const label="text-sm leading-5 font-normal";
const input="h-[52px] rounded-lg bg-white px-3.5 py-[13px] text-base leading-6 md:text-base placeholder:text-sm";
const serviceLink="mt-5 flex w-fit items-center gap-1.5 text-sm leading-5 text-primary hover:underline";

export const metadata: Metadata = { robots: privatePageRobots };
export default async function Login({searchParams}:{searchParams:Promise<SearchParams>}) {
 const {error,next,sifre}=normalizeSearchParams(await searchParams);
 const returnTo=safeReturnTo(next);
 // Signup, password reset and verification links need account e-mail (#1303); while it is off only login is offered.
 const accountEmail=accountEmailEnabled();
 return <section className="mx-auto mt-[30px] mb-5 min-h-[55vh] max-w-[440px] px-6 pt-7 pb-14 max-[600px]:pt-6 max-[600px]:pb-10">
  <p className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">GETİRBAKİM / HESABIM</p>
  <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Giriş yap.</h1>
  <p className="text-base leading-6 text-muted-foreground">Hesabınla siparişlerini, adreslerini ve garajını yönet. Onaylı servis hesapları B2B fiyatlarını görür.</p>
  {sifre === "yenilendi" && !error && <Alert className={cn(storeSuccessBox, "my-4")} role="status">Şifren yenilendi. Yeni şifrenle giriş yap.</Alert>}
  {error === "dogrulama" && accountEmail
   ? <Alert className={cn(storeErrorBox, "my-4")}><p className="m-0">E-posta adresin henüz doğrulanmadı. Gelen kutundaki bağlantıyla hesabını doğrula.</p><Link className="mt-2 block w-fit py-2 font-medium underline" href={verificationResendPath(returnTo)}>Doğrulama e-postasını yeniden gönder</Link></Alert>
   : error && <Alert className={cn(storeErrorBox, "my-4")}>{error === "limit" ? "Çok fazla giriş denemesi. 15 dakika sonra tekrar dene." : "Giriş bilgileri geçersiz veya hesap henüz onaylanmamış."}</Alert>}
  <form action={login} className="grid gap-5">
   {returnTo && <input type="hidden" name="next" value={returnTo}/>}
   <Field className={field}><FieldLabel htmlFor="login-email" className={label}>E-posta</FieldLabel><Input id="login-email" className={input} type="email" name="email" autoComplete="username" maxLength={200} required/></Field>
   <Field className={field}><FieldLabel htmlFor="login-password" className={label}>Şifre</FieldLabel><Input id="login-password" className={input} type="password" name="password" autoComplete="current-password" maxLength={72} required/>{accountEmail && <Link className="w-fit text-sm leading-5 text-primary hover:underline" href="/sifre-yenile">Şifreni mi unuttun?</Link>}</Field>
   <Button type="submit" className={cn(storeButton({ intent: "primary", size: "lg" }), "w-full")}>Giriş yap ↗</Button>
  </form>
  <p className="mt-4 text-[13px] leading-[1.8] [&_a]:text-primary [&_a]:underline"><Link href="/kvkk-aydinlatma-metni">KVKK Aydınlatma Metni</Link> · <Link href="/gizlilik-politikasi">Gizlilik Politikası</Link></p>
  {accountEmail && <p className="mt-[25px] text-sm leading-[22px] text-muted-foreground">Hesabın yok mu? <LoginButton mode="register" next={returnTo ?? "/"} accountEmail={accountEmail}>Kayıt ol</LoginButton></p>}
  <p><Link className={serviceLink} href="/servisler/basvuru">Servis hesabına başvur →</Link></p>
  <Link className={serviceLink} href={catalogPath}>Bireysel alışverişe devam et →</Link>
 </section>;
}
