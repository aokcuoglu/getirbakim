import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { HeaderTools } from "@/components/navigation/header-tools";
import { CategoryMenu } from "@/components/navigation/category-menu";
import { SearchBox } from "@/components/navigation/search-box";
import { Select } from "@/components/ui/select";
import { SiteIcon } from "@/components/ui/site-icon";
import { getStoreCategories } from "@/modules/store/categories";

/** The one site header: every storefront route renders this; the administration workspace has its own shell. */
export async function SiteHeader() {
  const categories = await getStoreCategories();
  return <>
    <div className="utility-bar"><div className="shell utility-inner">
      <details className="mobile-information"><summary>Bilgi <SiteIcon name="chevron" size={13}/></summary><nav aria-label="Alışveriş bilgileri"><Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link><Link href="/teslimat-ve-iade">İade koşulları</Link><Link href="/giris">Hesabım</Link></nav></details>
      <div><Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link></div>
      <div className="locale-menus"><Select name="country" label="Ülke" defaultValue="TR" options={[{ value: "TR", label: "🇹🇷 Türkiye" }]}/><Select name="currency" label="Para birimi" defaultValue="TRY" options={[{ value: "TRY", label: "TRY ₺" }]}/></div>
    </div></div>
    <header className="store-header">
      <div className="shell header-main"><Link href="/" className="logo"><BrandLogo/></Link><SearchBox/><HeaderTools/></div>
      <details className="mobile-header-search"><summary aria-label="Parça aramasını aç"><SiteIcon name="search" size={20}/></summary><SearchBox/></details>
      <nav className="shell category-nav" aria-label="Kategoriler"><CategoryMenu categories={categories}/><Link className="nav-help" href="/bilgi/yardim"><SiteIcon name="help" size={14}/> Yardım al</Link></nav>
    </header>
  </>;
}
