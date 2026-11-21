import { CheckoutFooter } from "@/components/site-footer";

// Only the order page shows the full brand/link footer; the shared store layout renders the compact one everywhere else (#1133).
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<CheckoutFooter /></>;
}
