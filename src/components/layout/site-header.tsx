import Link from "next/link";
import { Wrench } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { HeaderTools } from "@/components/navigation/header-tools";
import { CategoryMenu, MobileInformationMenu } from "@/components/navigation/category-menu";
import { SearchBox, MobileSearchToggle } from "@/components/navigation/search-box";
import { Select } from "@/components/site/select";
import { SiteIcon } from "@/components/site/site-icon";
import { RouteFrame } from "@/components/layout/store-route";
import { getStoreCategories } from "@/modules/store/categories";
import { headerCategoryLinks } from "@/modules/store/category-tree";

const localeTrigger = "h-8 min-h-8 border-0 bg-transparent py-1.5 pr-[25px] pl-2 text-sm hover:border-0 hover:bg-transparent max-[600px]:pl-1 max-[600px]:text-sm";

/**
 * The one site header: every storefront route renders this; the administration workspace has its own shell.
 * Route variants (see RouteFrame): checkout shows the logo only; home has a compact centred header on phones;
 * home and the catalog pin the main row while their pages set body[data-home-scrolled] / body[data-catalog-scrolled].
 */
export async function SiteHeader() {
  const categories = await getStoreCategories();
  return <RouteFrame className="text-sm leading-5 font-normal text-foreground">
    <div className="site-topbar">
      <div className="site-topbar-inner">
        <MobileInformationMenu/>
        <div className="site-topbar-links">
          <Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link>
        </div>
        <div className="flex h-full items-center">
          <Select name="country" label="Ülke" defaultValue="TR" align="end" className="w-[112px] min-w-0 max-[600px]:w-[100px]" triggerClassName={localeTrigger} contentClassName="min-w-[130px]" options={[{ value: "TR", label: "🇹🇷 Türkiye" }]}/>
          <Select name="currency" label="Para birimi" defaultValue="TRY" align="end" className="w-20 min-w-0 max-[600px]:w-[70px]" triggerClassName={localeTrigger} contentClassName="min-w-[130px]" options={[{ value: "TRY", label: "TRY ₺" }]}/>
        </div>
      </div>
    </div>
    <header className="site-header">
      <div className="site-header-row">
        <Link href="/" className="inline-flex shrink-0 items-center">
          <BrandLogo className="w-[158px] max-[600px]:w-[148px] max-[370px]:w-[148px] group-data-[route=home]/route:max-[600px]:w-[150px] group-data-[route=checkout]/route:w-[180px] group-data-[route=checkout]/route:max-[600px]:w-[148px] group-data-[route=checkout]/route:max-[370px]:w-[120px]"/>
        </Link>
        <SearchBox/>
        <HeaderTools/>
      </div>
      <MobileSearchToggle/>
      <nav aria-label="Kategoriler" className="site-header-nav">
        <CategoryMenu links={headerCategoryLinks(categories)}/>
        <Link className="ml-auto inline-flex min-h-5 items-center gap-1.5 text-brand hover:underline hover:underline-offset-3" href="/bakim-robotu" prefetch={false}><Wrench size={14} aria-hidden="true"/> Bakım Robotu</Link>
        <Link className="inline-flex min-h-5 items-center gap-1.5 text-[#923830] max-[1100px]:hidden" href="/bilgi/yardim"><SiteIcon name="help" size={14}/> Yardım al</Link>
      </nav>
    </header>
  </RouteFrame>;
}
