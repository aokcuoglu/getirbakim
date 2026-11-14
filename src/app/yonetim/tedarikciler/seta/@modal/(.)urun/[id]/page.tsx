import { SupplierItemRoute, type SupplierItemRouteProps } from "@/components/admin/supplier-item-route";

// The product page's body in a dialog over the list; urun/[id]/page.tsx renders the same body as a full page.
export default function Page(props: SupplierItemRouteProps) {
  return <SupplierItemRoute supplier="seta" modal {...props}/>;
}
