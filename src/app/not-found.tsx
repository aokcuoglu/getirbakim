import StoreNotFound from "./(store)/not-found";

// Unmatched URLs render here, inside the root layout only. Next serialises this element into every page's RSC payload
// as the root not-found boundary, so it must stay light: no SiteHeader/SiteFooter (category tree) here.
// notFound() in storefront pages uses (store)/not-found.tsx inside the store layout; /yonetim has its own.
export default function NotFound() {
  return <main id="main-content" tabIndex={-1}><StoreNotFound/></main>;
}
