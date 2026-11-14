import { SupplierItemRoute, type SupplierItemRouteProps } from "@/components/admin/supplier-item-route";

export default function Page(props: SupplierItemRouteProps) {
  return <SupplierItemRoute supplier="manuel" {...props}/>;
}
