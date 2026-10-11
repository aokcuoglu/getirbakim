import { SiteHeader } from "@/components/layout/site-header";
import { siteUrl } from "@/lib/site";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { StorefrontChrome } from "@/components/layout/storefront-chrome";
import "./globals.css";
export const metadata:Metadata={title:"Getirbakim | Aracın için doğru parça",metadataBase:new URL(siteUrl),verification:{google:process.env.GOOGLE_SITE_VERIFICATION},description:"Aracın için, parçadan anlayan insanların yedek parça mağazası. Bir bakalım, doğru parçayı bulalım.",openGraph:{siteName:"Getirbakim",locale:"tr_TR",type:"website",images:[{url:"/brand/social-getirbakim.png",width:1080,height:1080,alt:"Getirbakim — Bir bakalım, doğru parçayı bulalım."}]}};
// Applies the saved workspace theme before first paint on full loads of /yonetim; AdminTheme covers client navigation.
const adminThemeScript=`try{if(location.pathname.startsWith("/yonetim"))document.documentElement.classList.toggle("dark",localStorage.getItem("gb-admin-theme")==="dark")}catch(e){}`;
export default function Layout({children}:{children:React.ReactNode}) {
 return <html lang="tr" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:adminThemeScript}}/></head><body><a className="fixed top-3 left-3 z-100 -translate-y-[150%] rounded-lg bg-primary px-5 py-3 text-primary-foreground transition-transform focus:translate-y-0" href="#main-content">İçeriğe geç</a><StorefrontChrome><SiteHeader/></StorefrontChrome><main id="main-content" tabIndex={-1}>{children}</main><StorefrontChrome><SiteFooter/></StorefrontChrome></body></html>;
}
