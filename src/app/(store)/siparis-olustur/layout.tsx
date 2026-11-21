import { CheckoutFooter } from "@/components/site-footer";

// Deliberate: a nested layout renders inside <main>, so this footer is not a contentinfo landmark here (no role="contentinfo": a nested one fails axe).
// The alternative is a route-group split of the store layout.
// Only the order page shows the full brand/link footer; the shared store layout renders the compact one everywhere else (#1133).
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<CheckoutFooter /></>;
}
