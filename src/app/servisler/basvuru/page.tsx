import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import type { Metadata } from "next";
import Link from "next/link";
import { applyForService } from "@/modules/auth/service-application";
export const metadata: Metadata = { title: "Servis hesabı başvurusu | Getirbakim", robots: { index: false, follow: true } };
export default async function Application({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { sent, error } = normalizeSearchParams(await searchParams);
  return <section className="shell page-section application-page">
    <Link href="/servisler" className="back">← Servisler için Getirbakim</Link>
    <h1 className="page-title">Servis hesabına başvur.</h1>
    {sent === "1" ? <>
      <p className="notice" role="status">Başvurun alındı. Yeni başvurular servis bilgileri kontrol edildikten sonra değerlendirilir. Bu e-posta ile zaten bir hesabın varsa mevcut hesabını kullanabilirsin.</p>
      <p>Başvurun onaylandıktan sonra belirlediğin şifreyle giriş yapabilirsin. Soruların için <a href="tel:+902163870078">0216 387 00 78</a> üzerinden bize ulaş.</p>
      <Link href="/giris" className="button">Servis girişine git</Link>
    </> : <>
      <p className="lead">Servisini tanıyalım, parça ihtiyaçlarına birlikte bakalım. B2B fiyatları yönetici onayından sonra açılır.</p>
      {error && <p className="error" role="alert">{error === "limit" ? "Başvuru deneme sınırına ulaşıldı. Bir saat sonra tekrar dene veya destek ekibimize ulaş." : "Alanları kontrol et. Şifre en az 12 karakter ve en fazla 72 UTF-8 bayt olmalı; telefon 10–15 rakam içermeli. Kullanım koşullarını kabul et."}</p>}
      <form action={applyForService} className="stack">
        <label>Servis adı<input name="name" autoComplete="organization" minLength={2} maxLength={150} required/></label>
        <label>Yetkili adı ve soyadı<input name="contactName" autoComplete="name" minLength={2} maxLength={150} required/></label>
        <label>İl / ilçe<input name="city" autoComplete="address-level2" minLength={2} maxLength={100} required/></label>
        <label>Telefon<input name="phone" type="tel" autoComplete="tel" minLength={10} maxLength={25} required/></label>
        <label>E-posta<input name="email" type="email" autoComplete="email" maxLength={200} required/></label>
        <label>Şifre (en az 12 karakter)<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required/></label>
        <label className="application-trap" aria-hidden="true">Web sitesi<input name="website" tabIndex={-1} autoComplete="off" defaultValue=""/></label>
        <label className="terms"><input name="terms" type="checkbox" required/><span><Link href="/uyelik-ve-kullanim-kosullari">Üyelik ve kullanım koşullarını</Link> okudum, kabul ediyorum.</span></label>
        <p className="muted">Başvurudaki iletişim bilgilerini değerlendirme ve hesap işlemleri için kullanırız. Ayrıntılar: <Link href="/kvkk-aydinlatma-metni">KVKK Aydınlatma Metni</Link> ve <Link href="/gizlilik-politikasi">Gizlilik Politikası</Link>.</p>
        <button type="submit">Başvuruyu gönder</button>
      </form></>}
  </section>;
}
