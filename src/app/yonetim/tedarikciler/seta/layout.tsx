import type { ReactNode } from "react";
import { SupplierModalSlot } from "@/components/admin/supplier-item-dialog";

// @modal shows a product over the list when its code is clicked (@modal/(.)urun/[id]); elsewhere it renders nothing.
export default function Layout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return <>{children}<SupplierModalSlot>{modal}</SupplierModalSlot></>;
}
