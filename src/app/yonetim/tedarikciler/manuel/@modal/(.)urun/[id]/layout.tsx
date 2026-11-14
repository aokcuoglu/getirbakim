import type { ReactNode } from "react";
import { SupplierItemDialog } from "@/components/admin/supplier-item-dialog";

export default function ProductDialogLayout({ children }: { children: ReactNode }) {
  return <SupplierItemDialog>{children}</SupplierItemDialog>;
}
