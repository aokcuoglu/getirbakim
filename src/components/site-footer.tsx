import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { legalLinks } from "@/content/legal";
import {getStoreCategories} from "@/modules/store/categories";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import {ResponsiveFooterGroup} from "./responsive-footer-group";

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

export async function SiteFooter() {
  const allCategories=await getStoreCategories();
 const categories=allCategories.filter(c=>c.parentId===null);
 const catalogCategories=[...categories,...allCategories.filter(c=>["Fren balataları","Fren kaliperleri","Motor yağları","Amortisörler","Fren diskleri","Debriyaj setleri","Marş motorları","Triger setleri","Yağ filtreleri","Silecekler"].includes(c.name))];
 const information=[...new Map(groups.flatMap(group=>group.links).map(link=>[link.href,link])).values()];
  return (
    <footer>
      <div className="shell home-footer-links">
        <ResponsiveFooterGroup title="Yardıma mı ihtiyacın var?"><Link href="/iletisim">İletişime geç <span aria-hidden="true">›</span></Link></ResponsiveFooterGroup>
        <ResponsiveFooterGroup title="Faydalı bilgiler">{information.map(link=><Link key={link.href} href={link.href}>{link.title}</Link>)}</ResponsiveFooterGroup>
        <ResponsiveFooterGroup title="Kategoriler">{catalogCategories.map(category=><Link key={category.id} href={"/katalog?category="+category.slug}>{category.name}</Link>)}</ResponsiveFooterGroup>
      </div>
      <div className="shell catalog-footer-links">
        <section><h2>Yardıma mı ihtiyacın var?</h2><Link href="/iletisim">İletişime geç <span aria-hidden="true">›</span></Link></section>
        <nav aria-label="Katalog alışveriş bilgileri"><h2>Faydalı bilgiler</h2>{information.map(link=><Link key={link.href} href={link.href}>{link.title}</Link>)}</nav>
        <nav aria-label="Katalog alt kategorileri"><h2>Kategoriler</h2>{catalogCategories.map(category=><Link key={category.id} href={"/katalog?category="+category.slug}>{category.name}</Link>)}</nav>
      </div>
      <div className="shell footer-grid">
        <div className="footer-brand">
          <Link href="/" className="logo"><BrandLogo/></Link>
          <p>Bir bakalım,<br/>doğru parçayı bulalım.</p>
          <span className="country">🇹🇷 Türkiye · Türkçe · TRY</span>
        </div>
        {groups.map((group, index) => (
          <nav key={group.title} aria-labelledby={`footer-group-${index}`}>
            <h2 id={`footer-group-${index}`}>{group.title}</h2>
            {group.links.map(link => <Link key={link.href} href={link.href}>{link.title}</Link>)}
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
        <span>Aracın için doğru parça.</span>
      </div>
    </footer>
  );
}
