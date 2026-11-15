import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/site-footer";
import { StoreTags } from "@/components/privacy/store-tags";
import { siteJsonLd } from "@/lib/site";
import "@/app/storefront.css";

// Storefront chrome: only storefront routes render the header (category tree, garage, cart) and footer.
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd).replace(/</g, "\\u003c") }}/><StoreTags><SiteHeader/><main id="main-content" tabIndex={-1}>{children}</main><SiteFooter/></StoreTags></>;
}
