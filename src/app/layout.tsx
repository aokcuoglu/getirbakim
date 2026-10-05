import { HeaderTools } from "@/components/navigation/header-tools";
import { BrandLogo } from "@/components/brand-logo";
import { siteUrl } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Select } from "@/components/ui/select";
import { CategoryMenu } from "@/components/navigation/category-menu";
import { categories } from "@/modules/store/catalog";
import { SearchBox } from "@/components/navigation/search-box";
import { SiteIcon } from "@/components/ui/site-icon";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";
import "@/styles/design-system.css";
import "@/styles/storefront.css";
import "@/styles/auth-modal.css";
import "@/styles/commerce.css";
import "@/styles/legal.css";
import "@/styles/brand.css";
import "@/styles/cookie-consent.css";
import "@/styles/vehicle-sheet.css";
import "@/styles/garage.css";
export const metadata:Metadata={title:"Getirbakim | Aracın için doğru parça",metadataBase:new URL(siteUrl),verification:{google:process.env.GOOGLE_SITE_VERIFICATION},description:"Araç sahipleri ve oto servisleri için, parçadan anlayan insanların yedek parça mağazası. Bir bakalım, doğru parçayı bulalım.",openGraph:{siteName:"Getirbakim",locale:"tr_TR",type:"website",images:[{url:"/brand/social-getirbakim.png",width:1080,height:1080,alt:"Getirbakim — Bir bakalım, doğru parçayı bulalım."}]}};
export default function Layout({children}:{children:React.ReactNode}) {
 return <html lang="tr"><body><a className="skip-link" href="#main-content">İçeriğe geç</a><div className="utility-bar"><div className="shell utility-inner"><div><Link href="/bilgi/teslimat">Teslimat</Link><Link href="/bilgi/hakkimizda">Hakkımızda</Link><Link href="/bilgi/yardim">Yardım merkezi</Link><Link href="/servisler">Servisler için B2B <ArrowRight size={12}/></Link></div><div className="locale-menus"><Select name="country" label="Ülke" defaultValue="TR" options={[{value:"TR",label:"🇹🇷 Türkiye"}]}/><Select name="currency" label="Para birimi" defaultValue="TRY" options={[{value:"TRY",label:"TRY ₺"}]}/></div></div></div><header className="store-header"><div className="shell header-main"><Link href="/" className="logo"><BrandLogo/></Link><SearchBox/><HeaderTools/></div><nav className="shell category-nav"><CategoryMenu categories={categories.map(c=>({slug:c.slug,name:c.name,image:`/media/trodo/images/${({parts:"3_car_parts.jpg",brakes:"252_brake_system.jpg",filter:"241_filters.jpg",oil:"956_oils_and_fluids.jpg",wipers:"607_windscreen_wipers.jpg",tools:"967_accessories_and_equipment.jpg"})[c.art]}`}))}/><Link href="/katalog?category=yedek-parca">Yedek parçalar</Link><Link href="/katalog?category=fren">Fren sistemi</Link><Link href="/katalog?category=filtre">Filtreler</Link><Link href="/katalog?category=yag">Yağlar ve sıvılar</Link><Link href="/katalog?category=silecek">Silecekler</Link><Link href="/katalog?category=aksesuar">Aksesuarlar</Link><Link className="nav-help" href="/bilgi/yardim"><SiteIcon name="help" size={14}/> Yardım al</Link></nav></header><main id="main-content" tabIndex={-1}>{children}</main><section className="service-strip"><div className="shell"><div><SiteIcon name="lens" size={24}/><span><b>Kolay parça arama</b><small>Ürün adı, kodu veya OEM numarasıyla</small></span></div><div><SiteIcon name="garage" size={24}/><span><b>Aracını garajına ekle</b><small>Araç bilgilerin her zaman elinin altında</small></span></div><div><SiteIcon name="truck" size={24}/><span><b>Tek noktadan tedarik</b><small>Birleştirilmiş sevkiyat operasyonu</small></span></div><div><SiteIcon name="support" size={24}/><span><b>Servisler için B2B</b><small>Onaylı hesaplara özel fiyatlar</small></span></div></div></section><SiteFooter/></body></html>;
}
