import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { HeaderTools } from "@/components/navigation/header-tools";
import { CategoryMenu } from "@/components/navigation/category-menu";
import { SearchBox } from "@/components/navigation/search-box";
import { Select } from "@/components/ui/select";
import { SiteIcon } from "@/components/ui/site-icon";
import { categories } from "@/modules/store/catalog";

const categoryImages: Record<string, string> = { parts: "3_car_parts.jpg", brakes: "252_brake_system.jpg", filter: "241_filters.jpg", oil: "956_oils_and_fluids.jpg", wipers: "607_windscreen_wipers.jpg", tools: "967_accessories_and_equipment.jpg" };
const menuCategories = categories.map(c => ({ slug: c.slug, name: c.name, image: `/media/trodo/images/${categoryImages[c.art]}` }));

/** The one site header: every route, storefront and administration alike, renders this. */
export function SiteHeader() {
  return <>
    <div className="utility-bar"><div className="shell utility-inner">
      <div><Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link><Link href="/servisler">Servisler için B2B <ArrowRight size={12}/></Link></div>
      <div className="locale-menus"><Select name="country" label="Ülke" defaultValue="TR" options={[{ value: "TR", label: "🇹🇷 Türkiye" }]}/><Select name="currency" label="Para birimi" defaultValue="TRY" options={[{ value: "TRY", label: "TRY ₺" }]}/></div>
    </div></div>
    <header className="store-header">
      <div className="shell header-main"><Link href="/" className="logo"><BrandLogo/></Link><SearchBox/><HeaderTools/></div>
      <nav className="shell category-nav" aria-label="Kategoriler"><CategoryMenu categories={menuCategories}/><Link href="/katalog?category=yedek-parca">Yedek parçalar</Link><Link href="/katalog?category=fren">Fren sistemi</Link><Link href="/katalog?category=filtre">Filtreler</Link><Link href="/katalog?category=yag">Yağlar ve sıvılar</Link><Link href="/katalog?category=silecek">Silecekler</Link><Link href="/katalog?category=aksesuar">Aksesuarlar</Link><Link className="nav-help" href="/bilgi/yardim"><SiteIcon name="help" size={14}/> Yardım al</Link></nav>
    </header>
  </>;
}
