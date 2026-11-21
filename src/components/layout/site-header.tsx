import Link from "next/link";
import { Wrench } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { HeaderTools } from "@/components/navigation/header-tools";
import { CategoryMenu } from "@/components/navigation/category-menu";
import { SheetAccount } from "@/components/navigation/sheet-account";
import { SearchBox } from "@/components/navigation/search-box";
import { SiteIcon } from "@/components/site/site-icon";
import { RouteFrame } from "@/components/layout/store-route";
import { getStoreCategories } from "@/modules/store/categories";
import { headerCategoryLinks } from "@/modules/store/category-tree";

/**
 * The one site header: every storefront route renders this; the administration workspace has its own shell.
 * Route variants (see RouteFrame): checkout shows the logo only; phones (≤600px) stack logo and tools, a full-width search and the category strip, on every route;
 * home and the catalog pin the main row while their pages set body[data-home-scrolled] / body[data-catalog-scrolled] (600px and up).
 * On phones HeaderPin makes the whole frame (`.site-chrome`) sticky once it has left the viewport: it hides while scrolling down and
 * brings back the logo/tools and search rows, without the category strip, on the way up (#1089).
 */
export async function SiteHeader() {
  const categories = await getStoreCategories();
  return <RouteFrame pin className="site-chrome">
    <div className="site-topbar">
      <div className="site-topbar-inner">
        <div className="site-topbar-links">
          <Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link><Link href="/rehber">Rehber</Link>
        </div>
        <div className="site-topbar-locale"><span><span className="sr-only">Ülke: </span><span aria-hidden="true">🇹🇷</span> Türkiye</span><span><span className="sr-only">Para birimi: </span>TRY ₺</span></div>
      </div>
    </div>
    <header className="site-header">
      <div className="site-header-row">
        <Link href="/" className="inline-flex shrink-0 items-center">
          <BrandLogo className="site-logo"/>
        </Link>
        <SearchBox/>
        <HeaderTools/>
      </div>
      <nav aria-label="Kategoriler" className="site-header-nav">
        <CategoryMenu links={headerCategoryLinks(categories)} account={<SheetAccount/>}/>
        <Link className="site-nav-robot" href="/bakim-robotu" prefetch={false}><Wrench size={14} aria-hidden="true"/> Bakım Robotu</Link>
        <Link className="site-nav-help" href="/bilgi/yardim"><SiteIcon name="help" size={14}/> Yardım al</Link>
      </nav>
    </header>
  </RouteFrame>;
}
