import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { legalLinks } from "@/content/legal";
import { categories } from "@/modules/store/catalog";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import { LoginButton } from "@/components/auth/login-button";

type FooterLink = { href: string; title: string };

function legalLink(slug: (typeof legalLinks)[number]["slug"]): FooterLink {
  const link = legalLinks.find(link => link.slug === slug)!;
  return { href: `/${link.slug}`, title: link.title };
}

const groups = [
  {
    title: "Kurumsal",
    links: [
      { href: "/bilgi/hakkimizda", title: "Hakkımızda" },
      legalLink("iletisim"),
      { href: "/servisler", title: "Servisler için Getirbakim" },
      { href: "/giris", title: "B2B servis girişi" },
    ],
  },
  {
    title: "Alışveriş ve Destek",
    links: [
      { href: "/katalog", title: "Tüm ürünler" },
      { href: "/garaj", title: "Garajım" },
      { href: "/sepet", title: "Sepetim" },
      { href: "/bilgi/yardim", title: "Yardım merkezi" },
      { href: "/bilgi/uyumluluk", title: "Parça uyumluluğu" },
      legalLink("teslimat-ve-iade"),
    ],
  },
  {
    title: "Sözleşmeler",
    links: [
      legalLink("mesafeli-satis-sozlesmesi"),
      legalLink("on-bilgilendirme-formu"),
      legalLink("uyelik-ve-kullanim-kosullari"),
    ],
  },
  {
    title: "Gizlilik",
    links: [
      legalLink("gizlilik-politikasi"),
      legalLink("kvkk-aydinlatma-metni"),
      legalLink("cerez-politikasi"),
    ],
  },
];

export function SiteFooter() {
  return (
    <footer>
      <div className="shell footer-grid">
        <div className="footer-brand">
          <Link href="/" className="logo"><BrandLogo/></Link>
          <p>Bir bakalım,<br/>doğru parçayı bulalım.</p>
          <span className="country">🇹🇷 Türkiye · Türkçe · TRY</span>
          <p>Profesyonel servisler için özel fiyatlar ve tek noktadan parça tedariki.</p>
          <LoginButton className="footer-b2b footer-login">B2B servis girişi <ArrowRight size={16}/></LoginButton>
        </div>
        {groups.map((group, index) => (
          <nav key={group.title} aria-labelledby={`footer-group-${index}`}>
            <h2 id={`footer-group-${index}`}>{group.title}</h2>
            {group.links.map(link => link.href === "/giris"
              ? <LoginButton key={link.href} className="footer-login">{link.title}</LoginButton>
              : <Link key={link.href} href={link.href}>{link.title}</Link>)}
          </nav>
        ))}
      </div>
      <nav className="shell footer-categories" aria-labelledby="footer-categories-title">
        <h2 id="footer-categories-title">Kategoriler</h2>
        {categories.map(category => <Link key={category.slug} href={`/katalog?category=${category.slug}`}>{category.name}</Link>)}
      </nav>
      <div className="shell footer-bottom">
        <span>© {new Date().getFullYear()} ERGUL ENERJI SAN TIC LTD STI</span>
        <CookieConsent/>
        <span>Bireysel araç sahipleri ve profesyonel servisler için.</span>
      </div>
    </footer>
  );
}
