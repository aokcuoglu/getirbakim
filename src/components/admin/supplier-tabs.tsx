"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Tab = "transfer" | "products";

export function SupplierTabs({ transfer, products, initialTab = "products" }: {
  transfer: ReactNode;
  products: ReactNode;
  initialTab?: Tab;
}) {
  const [active, setActive] = useState<Tab>(initialTab);
  return <Tabs value={active} onValueChange={value => setActive(value as Tab)} className="gap-4">
    <TabsList variant="line" aria-label="Başbuğ yönetimi" className="w-full justify-start border-b">
      <TabsTrigger value="products" className="flex-none px-3">Ürünler</TabsTrigger>
      <TabsTrigger value="transfer" className="flex-none px-3">Senkronizasyon ve kalite</TabsTrigger>
    </TabsList>
    {/* Quality links in the transfer tab filter the product list, so following one also switches tabs. */}
    <TabsContent value="products" keepMounted>{products}</TabsContent>
    <TabsContent value="transfer" keepMounted onClick={event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('a[data-supplier-tab="products"]')) setActive("products");
    }}>{transfer}</TabsContent>
  </Tabs>;
}
