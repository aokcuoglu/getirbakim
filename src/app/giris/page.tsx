import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import { login } from "@/modules/auth/actions";
import { safeReturnTo } from "@/modules/auth/return-to";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const field="gap-2";
const label="text-sm leading-5 font-normal";
const input="h-[52px] rounded-lg bg-white px-3.5 py-[13px] text-base leading-6 md:text-base placeholder:text-sm";
const serviceLink="mt-5 flex w-fit items-center gap-1.5 text-sm leading-5 text-primary hover:underline";

export default async function Login({searchParams}:{searchParams:Promise<SearchParams>}) {
 const {error,next}=normalizeSearchParams(await searchParams);
 const returnTo=safeReturnTo(next);
 return <section className="mx-auto mt-[30px] mb-5 min-h-[55vh] max-w-[440px] px-6 pt-7 pb-14 max-[600px]:pt-6 max-[600px]:pb-10">
  <p className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">GETİRBAKİM / SERVİS HESABI</p>
  <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Profesyoneller için.</h1>
  <p className="text-base leading-6 text-muted-foreground">Onaylı servis hesabınla B2B fiyatlarına ulaş. Bireysel alışveriş için giriş yapman gerekmez.</p>
  {error && <Alert className="my-4 rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]">{error === "limit" ? "Çok fazla giriş denemesi. 15 dakika sonra tekrar dene." : "Giriş bilgileri geçersiz veya servis hesabı onaylanmamış."}</Alert>}
  <form action={login} className="grid gap-5">
   {returnTo && <input type="hidden" name="next" value={returnTo}/>}
   <Field className={field}><FieldLabel htmlFor="login-email" className={label}>E-posta</FieldLabel><Input id="login-email" className={input} type="email" name="email" autoComplete="username" maxLength={200} required/></Field>
   <Field className={field}><FieldLabel htmlFor="login-password" className={label}>Şifre</FieldLabel><Input id="login-password" className={input} type="password" name="password" autoComplete="current-password" maxLength={72} required/></Field>
   <Button type="submit" className="h-auto min-h-12 w-full rounded-lg px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong">Giriş yap ↗</Button>
  </form>
  <p className="mt-4 text-[13px] leading-[1.8] [&_a]:text-primary [&_a]:underline"><Link href="/kvkk-aydinlatma-metni">KVKK Aydınlatma Metni</Link> · <Link href="/gizlilik-politikasi">Gizlilik Politikası</Link></p>
  <p className="mt-[25px] text-sm leading-[22px] text-muted-foreground">Hesaplar Getirbakim yönetimi tarafından servis onayından sonra açılır.</p>
  <p><Link className={serviceLink} href="/servisler/basvuru">Servis hesabına başvur →</Link></p>
  <Link className={serviceLink} href="/katalog">Bireysel alışverişe devam et →</Link>
 </section>;
}
