import { defaultSocialImage, siteDescription, siteOpenGraph, siteUrl, siteVerification } from "@/lib/site";
import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:{default:"Getirbakim | Aracın için doğru parça",template:"%s | Getirbakim"},metadataBase:new URL(siteUrl),verification:siteVerification(),description:siteDescription,openGraph:{...siteOpenGraph,images:[defaultSocialImage]},twitter:{card:"summary_large_image"}};
// Applies the saved workspace theme before first paint on full loads of /yonetim; AdminTheme covers client navigation.
const adminThemeScript=`try{if(location.pathname.startsWith("/yonetim"))document.documentElement.classList.toggle("dark",localStorage.getItem("gb-admin-theme")==="dark")}catch(e){}`;
// The shared shell only: the storefront chrome lives in (store)/layout.tsx and the workspace shell in yonetim/layout.tsx.
// Each of them (and not-found.tsx) renders the <main id="main-content"> the skip link points at.
export default function Layout({children}:{children:React.ReactNode}) {
 return <html lang="tr" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:adminThemeScript}}/></head><body><a className="fixed top-3 left-3 z-100 -translate-y-[150%] rounded-lg bg-primary px-5 py-3 text-primary-foreground transition-transform focus:translate-y-0" href="#main-content">İçeriğe geç</a>{children}</body></html>;
}
