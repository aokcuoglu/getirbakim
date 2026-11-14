import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/site-footer";

// Storefront chrome: only storefront routes render the header (category tree, garage, cart) and footer.
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <><SiteHeader/><main id="main-content" tabIndex={-1}>{children}</main><SiteFooter/></>;
}
