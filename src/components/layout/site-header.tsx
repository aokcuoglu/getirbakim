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

const localeTrigger = "h-8 min-h-8 border-0 bg-transparent py-1.5 pr-[25px] pl-2 text-sm hover:border-0 hover:bg-transparent max-[600px]:pl-1 max-[600px]:text-sm";

/**
 * The one site header: every storefront route renders this; the administration workspace has its own shell.
 * Route variants (see RouteFrame): checkout shows the logo only; home has a compact centred header on phones;
 * home and the catalog pin the main row while their pages set body[data-home-scrolled] / body[data-catalog-scrolled].
 */
export async function SiteHeader() {
  const categories = await getStoreCategories();
  return <RouteFrame className="text-sm leading-5 font-normal text-foreground">
    <div className="h-[42px] border-b border-border bg-white max-[600px]:hidden group-data-[route=checkout]/route:hidden group-data-[route=home]/route:max-[600px]:block">
      <div className="mx-auto flex h-full w-full max-w-[1350px] items-center justify-between gap-6 px-[15px]">
        <MobileInformationMenu/>
        <div className="flex h-full items-center gap-6 group-data-[route=home]/route:max-[600px]:hidden [&>a]:inline-flex [&>a]:items-center [&>a]:gap-1.5 [&>a:hover]:text-brand max-[850px]:[&>a:first-child]:hidden">
          <Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link>
        </div>
        <div className="flex h-full items-center">
          <Select name="country" label="Ülke" defaultValue="TR" align="end" className="w-[112px] min-w-0 max-[600px]:w-[100px]" triggerClassName={localeTrigger} contentClassName="min-w-[130px]" options={[{ value: "TR", label: "🇹🇷 Türkiye" }]}/>
          <Select name="currency" label="Para birimi" defaultValue="TRY" align="end" className="w-20 min-w-0 max-[600px]:w-[70px]" triggerClassName={localeTrigger} contentClassName="min-w-[130px]" options={[{ value: "TRY", label: "TRY ₺" }]}/>
        </div>
      </div>
    </div>
    <header className={[
      "relative border-b border-border bg-white",
      "min-[601px]:in-data-home-scrolled:h-[131px] min-[601px]:in-data-catalog-scrolled:h-[131px]",
    ].join(" ")}>
      <div className={[
        "mx-auto flex h-[88px] w-full max-w-[1350px] items-center gap-7 px-[15px] py-6 max-[1100px]:gap-5 max-[850px]:gap-4",
        "max-[600px]:h-auto max-[600px]:min-h-[114px] max-[600px]:flex-wrap max-[600px]:gap-3 max-[600px]:py-[15px]",
        "group-data-[route=home]/route:max-[600px]:h-14 group-data-[route=home]/route:max-[600px]:min-h-14 group-data-[route=home]/route:max-[600px]:flex-nowrap group-data-[route=home]/route:max-[600px]:justify-center group-data-[route=home]/route:max-[600px]:gap-0 group-data-[route=home]/route:max-[600px]:py-[14px]",
        "group-data-[route=checkout]/route:h-[65px] group-data-[route=checkout]/route:min-h-[65px] group-data-[route=checkout]/route:py-4",
        "min-[601px]:in-data-home-scrolled:fixed min-[601px]:in-data-home-scrolled:inset-x-0 min-[601px]:in-data-home-scrolled:top-0 min-[601px]:in-data-home-scrolled:z-41 min-[601px]:in-data-home-scrolled:max-w-none! min-[601px]:in-data-home-scrolled:border-b min-[601px]:in-data-home-scrolled:border-border min-[601px]:in-data-home-scrolled:bg-white min-[601px]:in-data-home-scrolled:px-[max(15px,calc((100vw-1320px)/2))]!",
        "min-[601px]:in-data-catalog-scrolled:fixed min-[601px]:in-data-catalog-scrolled:inset-x-0 min-[601px]:in-data-catalog-scrolled:top-0 min-[601px]:in-data-catalog-scrolled:z-41 min-[601px]:in-data-catalog-scrolled:max-w-none! min-[601px]:in-data-catalog-scrolled:border-b min-[601px]:in-data-catalog-scrolled:border-border min-[601px]:in-data-catalog-scrolled:bg-white min-[601px]:in-data-catalog-scrolled:px-[max(15px,calc((100vw-1320px)/2))]!",
      ].join(" ")}>
        <Link href="/" className="inline-flex shrink-0 items-center">
          <BrandLogo className="w-[158px] max-[600px]:w-[148px] max-[370px]:w-[148px] group-data-[route=home]/route:max-[600px]:w-[150px] group-data-[route=checkout]/route:w-[180px] group-data-[route=checkout]/route:max-[600px]:w-[148px] group-data-[route=checkout]/route:max-[370px]:w-[120px]"/>
        </Link>
        <SearchBox/>
        <HeaderTools/>
      </div>
      <MobileSearchToggle/>
      <nav aria-label="Kategoriler" className={[
        "relative mx-auto flex h-[42px] min-h-[42px] w-full max-w-[1350px] items-center gap-7 px-[15px] pt-0 pb-[14px] text-sm font-medium whitespace-nowrap max-[1358px]:gap-6",
        "max-[1100px]:gap-[18px] max-[1100px]:overflow-x-auto max-[1100px]:text-[13px] max-[600px]:py-0",
        "has-data-mega-open:z-50",
        "group-data-[route=checkout]/route:hidden",
        "group-data-[route=home]/route:max-[600px]:static group-data-[route=home]/route:max-[600px]:h-0 group-data-[route=home]/route:max-[600px]:min-h-0 group-data-[route=home]/route:max-[600px]:overflow-visible group-data-[route=home]/route:max-[600px]:p-0",
        "min-[601px]:in-data-home-scrolled:invisible min-[601px]:in-data-catalog-scrolled:invisible",
      ].join(" ")}>
        <CategoryMenu categories={categories}/>
        <Link className="ml-auto inline-flex min-h-5 items-center gap-1.5 text-brand hover:underline hover:underline-offset-3" href="/bakim-robotu" prefetch={false}><Wrench size={14} aria-hidden="true"/> Bakım Robotu</Link>
        <Link className="inline-flex min-h-5 items-center gap-1.5 text-[#923830] max-[1100px]:hidden" href="/bilgi/yardim"><SiteIcon name="help" size={14}/> Yardım al</Link>
      </nav>
    </header>
  </RouteFrame>;
}
