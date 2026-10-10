import { SiteHeader } from "@/components/layout/site-header";
import { ServiceStrip } from "@/components/layout/service-strip";
import { siteUrl } from "@/lib/site";
import type { Metadata } from "next";
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
import "@/styles/purchase.css";
import "@/styles/site-header.css";
export const metadata:Metadata={title:"Getirbakim | Aracın için doğru parça",metadataBase:new URL(siteUrl),verification:{google:process.env.GOOGLE_SITE_VERIFICATION},description:"Aracın için, parçadan anlayan insanların yedek parça mağazası. Bir bakalım, doğru parçayı bulalım.",openGraph:{siteName:"Getirbakim",locale:"tr_TR",type:"website",images:[{url:"/brand/social-getirbakim.png",width:1080,height:1080,alt:"Getirbakim — Bir bakalım, doğru parçayı bulalım."}]}};
export default function Layout({children}:{children:React.ReactNode}) {
 return <html lang="tr"><body><a className="skip-link" href="#main-content">İçeriğe geç</a><SiteHeader/><main id="main-content" tabIndex={-1}>{children}</main><ServiceStrip/><SiteFooter/></body></html>;
}
