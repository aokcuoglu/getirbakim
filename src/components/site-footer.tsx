import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { legalLinks } from "@/content/legal";
import {getStoreCategories} from "@/modules/store/categories";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import {ResponsiveFooterGroup} from "./responsive-footer-group";
import {RouteFrame} from "@/components/layout/store-route";
import {cn} from "@/lib/utils";
import {SocialLinks} from "@/components/social-links";
import {currentAppVersion} from "@/lib/app-version";
import { catalogPath, categoryPath } from "@/modules/seo/paths";

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
      { href: "/giris", title: "Giriş yap / Kayıt ol" },
    ],
  },
  {
    title: "Alışveriş ve Destek",
    links: [
      { href: catalogPath, title: "Tüm ürünler" },
      { href: "/garaj", title: "Garajım" },
      { href: "/sepet", title: "Sepetim" },
      { href: "/bilgi/yardim", title: "Yardım merkezi" },
      { href: "/bilgi/uyumluluk", title: "Parça uyumluluğu" },
      { href: "/rehber", title: "Rehber" },
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

const shell="mx-auto w-full max-w-[1280px] px-8 max-[600px]:px-5";

function Legal() {
 const year=new Date().getFullYear();
 return <span>© {year} ERGUL ENERJI SAN TIC LTD STI<span className="ml-2 whitespace-nowrap tabular-nums" title="Uygulama sürümü"><span className="sr-only">Uygulama sürümü: </span>{currentAppVersion.label}</span></span>;
}

/** The compact link footer of every storefront route but checkout (RouteFrame renders nothing there). */
export async function SiteFooter() {
 const allCategories=await getStoreCategories();
 const categories=allCategories.filter(c=>c.parentId===null);
 const catalogCategories=[...categories,...allCategories.filter(c=>["Fren balataları","Fren kaliperleri","Motor yağları","Amortisörler","Fren diskleri","Debriyaj setleri","Marş motorları","Triger setleri","Yağ filtreleri","Silecekler"].includes(c.name))];
 const information=[...new Map(groups.flatMap(group=>group.links).map(link=>[link.href,link])).values()];
 return <RouteFrame except="checkout"><footer className="site-footer">
  <div className="site-footer-grid">
   <ResponsiveFooterGroup title="Yardıma mı ihtiyacın var?" accent><Link href="/iletisim">İletişime geç <span aria-hidden="true">›</span></Link></ResponsiveFooterGroup>
   <ResponsiveFooterGroup title="Faydalı bilgiler">{information.map(link=><Link key={link.href} href={link.href}>{link.title}</Link>)}</ResponsiveFooterGroup>
   <ResponsiveFooterGroup title="Kategoriler">{catalogCategories.map(category=><Link key={category.id} href={categoryPath(category.slug)}>{category.name}</Link>)}</ResponsiveFooterGroup>
  </div>
  <div className="site-footer-bar">
   <Legal/>
   <CookieConsent/>
   <div className="site-footer-bar-end"><span>Aracın için doğru parça.</span><SocialLinks/></div>
  </div>
 </footer></RouteFrame>;
}

/** The checkout page's footer: the full brand/link grid, mounted by siparis-olustur/layout.tsx only. */
export async function CheckoutFooter() {
 const categories=(await getStoreCategories()).filter(c=>c.parentId===null);
 return <footer className="bg-[#f7f8fa] pt-10 text-sm leading-5 text-foreground">
  <div className={cn(shell,"grid grid-cols-[1.2fr_repeat(4,minmax(0,1fr))] gap-7 pb-9 min-[851px]:max-[1100px]:grid-cols-4 max-[850px]:grid-cols-2 max-[850px]:gap-8 max-[600px]:gap-x-6 max-[600px]:gap-y-7")}>
   <div className="min-w-0 min-[851px]:max-[1100px]:col-span-full max-[600px]:col-span-full">
    <Link href="/" className="inline-flex items-center"><BrandLogo/></Link>
    <p className="my-4 text-[13px] leading-6 text-muted-foreground">Bir bakalım,<br/>doğru parçayı bulalım.</p>
    <span className="text-xs leading-5 text-muted-foreground">🇹🇷 Türkiye · Türkçe · TRY</span>
   </div>
   {groups.map((group, index) => (
    <nav key={group.title} aria-labelledby={`footer-group-${index}`} className="min-w-0">
     <h2 id={`footer-group-${index}`} className="mt-0 mb-4 text-sm leading-[22px] font-semibold">{group.title}</h2>
     {group.links.map(link => <Link key={link.href} href={link.href} className="checkout-footer-link">{link.title}</Link>)}
    </nav>
   ))}
  </div>
  <nav className={cn(shell,"flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border py-6 text-[13px] leading-[22px]")} aria-labelledby="footer-categories-title">
   <h2 id="footer-categories-title" className="m-0 text-[13px] leading-[22px] font-semibold">Kategoriler</h2>
   {categories.map(category => <Link key={category.slug} href={categoryPath(category.slug)} className="checkout-footer-category">{category.name}</Link>)}
  </nav>
  <div className={cn(shell,"flex items-center justify-between gap-6 border-t border-border pt-5 pb-6 text-xs leading-5 text-muted-foreground max-[600px]:flex-col max-[600px]:items-stretch max-[600px]:gap-2 max-[600px]:text-[11px]")}>
   <Legal/>
   <CookieConsent/>
   <div className="site-footer-bar-end"><span>Aracın için doğru parça.</span><SocialLinks/></div>
  </div>
 </footer>;
}
