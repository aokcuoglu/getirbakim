import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { legalLinks } from "@/content/legal";
import {getStoreCategories} from "@/modules/store/categories";
import { CookieConsent } from "@/components/privacy/cookie-consent";
import {ResponsiveFooterGroup} from "./responsive-footer-group";
import {FooterVariants,RouteFrame} from "@/components/layout/store-route";
import {cn} from "@/lib/utils";
import {SocialLinks} from "@/components/social-links";

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

const shell="mx-auto w-full max-w-[1280px] px-8 max-[600px]:px-5";
const muted="text-muted-foreground hover:text-brand hover:underline hover:underline-offset-3";

/**
 * The one site footer. Checkout keeps the full brand/link grid; every other route shows the compact
 * three-column link block (collapsible on phones on the home page).
 */
export async function SiteFooter() {
 const allCategories=await getStoreCategories();
 const categories=allCategories.filter(c=>c.parentId===null);
 const catalogCategories=[...categories,...allCategories.filter(c=>["Fren balataları","Fren kaliperleri","Motor yağları","Amortisörler","Fren diskleri","Debriyaj setleri","Marş motorları","Triger setleri","Yağ filtreleri","Silecekler"].includes(c.name))];
 const information=[...new Map(groups.flatMap(group=>group.links).map(link=>[link.href,link])).values()];
 const year=new Date().getFullYear();
 const links=<footer className="border-t border-border bg-white pt-12 text-sm leading-5 text-foreground group-data-[route=home]/route:max-[600px]:pt-4">
  <div className="mx-auto grid w-full max-w-[1350px] grid-cols-[2fr_1fr_1fr] gap-5 px-[15px] pb-10 group-data-[route=standard]/route:max-[768px]:grid-cols-2 group-data-[route=standard]/route:max-[768px]:[&>*:first-child]:col-span-full group-data-[route=home]/route:max-[600px]:grid-cols-1 group-data-[route=home]/route:max-[600px]:gap-0 group-data-[route=home]/route:max-[600px]:pb-4">
   <ResponsiveFooterGroup title="Yardıma mı ihtiyacın var?" accent><Link href="/iletisim">İletişime geç <span aria-hidden="true">›</span></Link></ResponsiveFooterGroup>
   <ResponsiveFooterGroup title="Faydalı bilgiler">{information.map(link=><Link key={link.href} href={link.href}>{link.title}</Link>)}</ResponsiveFooterGroup>
   <ResponsiveFooterGroup title="Kategoriler">{catalogCategories.map(category=><Link key={category.id} href={"/katalog?category="+category.slug}>{category.name}</Link>)}</ResponsiveFooterGroup>
  </div>
  <div className="mx-auto flex w-full max-w-[1350px] items-center justify-between gap-6 border-t border-border bg-[#f8f9f9] px-[15px] py-4 text-xs leading-5 text-muted-foreground max-[600px]:flex-col max-[600px]:items-stretch max-[600px]:gap-2 max-[600px]:text-[11px]">
   <span>© {year} ERGUL ENERJI SAN TIC LTD STI</span>
   <CookieConsent/>
   <div className="flex items-center gap-4 max-[600px]:justify-between"><span>Aracın için doğru parça.</span><SocialLinks/></div>
  </div>
 </footer>;
 const checkout=<footer className="bg-[#f7f8fa] pt-10 text-sm leading-5 text-foreground">
  <div className={cn(shell,"grid grid-cols-[1.2fr_repeat(4,minmax(0,1fr))] gap-7 pb-9 min-[851px]:max-[1100px]:grid-cols-4 max-[850px]:grid-cols-2 max-[850px]:gap-8 max-[600px]:gap-x-6 max-[600px]:gap-y-7")}>
   <div className="min-w-0 min-[851px]:max-[1100px]:col-span-full max-[600px]:col-span-full">
    <Link href="/" className="inline-flex items-center"><BrandLogo/></Link>
    <p className="my-4 text-[13px] leading-6 text-muted-foreground">Bir bakalım,<br/>doğru parçayı bulalım.</p>
    <span className="text-xs leading-5 text-muted-foreground">🇹🇷 Türkiye · Türkçe · TRY</span>
   </div>
   {groups.map((group, index) => (
    <nav key={group.title} aria-labelledby={`footer-group-${index}`} className="min-w-0">
     <h2 id={`footer-group-${index}`} className="mt-0 mb-4 text-sm leading-[22px] font-semibold">{group.title}</h2>
     {group.links.map(link => <Link key={link.href} href={link.href} className={cn(muted,"block py-[5px] text-[13px] leading-[22px] [overflow-wrap:anywhere] max-[600px]:py-2.5")}>{link.title}</Link>)}
    </nav>
   ))}
  </div>
  <nav className={cn(shell,"flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border py-6 text-[13px] leading-[22px]")} aria-labelledby="footer-categories-title">
   <h2 id="footer-categories-title" className="m-0 text-[13px] leading-[22px] font-semibold">Kategoriler</h2>
   {categories.map(category => <Link key={category.slug} href={`/katalog?category=${category.slug}`} className={cn(muted,"max-[600px]:py-2")}>{category.name}</Link>)}
  </nav>
  <div className={cn(shell,"flex items-center justify-between gap-6 border-t border-border pt-5 pb-6 text-xs leading-5 text-muted-foreground max-[600px]:flex-col max-[600px]:items-stretch max-[600px]:gap-2 max-[600px]:text-[11px]")}>
   <span>© {year} ERGUL ENERJI SAN TIC LTD STI</span>
   <CookieConsent/>
   <div className="flex items-center gap-4 max-[600px]:justify-between"><span>Aracın için doğru parça.</span><SocialLinks/></div>
  </div>
 </footer>;
 return <RouteFrame><FooterVariants links={links} checkout={checkout}/></RouteFrame>;
}
