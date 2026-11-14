import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/site-footer";
import StoreNotFound from "./(store)/not-found";

// Unmatched URLs render here, inside the root layout only, so the storefront chrome is added explicitly.
// notFound() in storefront pages uses (store)/not-found.tsx inside the store layout; /yonetim has its own.
export default function NotFound() {
  return <><SiteHeader/><main id="main-content" tabIndex={-1}><StoreNotFound/></main><SiteFooter/></>;
}
