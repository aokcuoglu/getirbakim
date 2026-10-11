"use client";

import { useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { SetaItem } from "@/modules/admin/seta";

export function SetaProductDetails({ item, cost, salePrice }: { item: SetaItem; cost: string; salePrice: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fields = [
    ["OEM", item.product_data.oe || "—"],
    ["Araç markası", item.product_data.vehicle_brand || "—"],
    ["Araç / açıklama", item.product_data.ac2 || "—"],
    ["Kategori", item.product_data.source_category || "—"],
    ["Bayi fiyatı · KDV hariç", cost],
    ["Satış fiyatı · KDV dahil", salePrice],
    ["Kaynak stok", item.stock_data ? item.stock_data.stok ? "Var" : "Yok" : "Veri yok"],
    ["Satış durumu", item.sale_stock_label || "Satışa kapalı"],
    ["Listede bulunma", item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif" : "Listede yok"],
    ["Veri kontrolü", item.conflicting ? "Çelişkili kayıt" : !item.price_data ? "Fiyat eksik" : item.product_count > 1 ? "Tekrarlanan kod" : "—"],
  ];
  return <Dialog>
    <DialogTrigger className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary" aria-label={`${item.code} ürün detayı`} title="Ürün detayını aç"><ArrowUpRight className="size-3.5" aria-hidden="true"/></DialogTrigger>
    {/* Cart forms submit their server action instead of the surrounding supplier filter navigation. */}
    <DialogContent className="admin-app max-h-[85dvh] overflow-y-auto sm:max-w-xl" initialFocus={titleRef} onSubmit={event => event.stopPropagation()}>
      <DialogHeader className="pr-8">
        <DialogTitle ref={titleRef} tabIndex={-1} className="break-words leading-snug outline-none">{item.product_data.ac}</DialogTitle>
        <DialogDescription className="font-mono">{item.code} · SETA</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>)}</dl>
      <div className="border-t pt-3">
        <h3 className="mb-2 text-sm font-semibold">Çapraz referanslar</h3>
        {Object.entries(item.product_data.cross ?? {}).length ? <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">{Object.entries(item.product_data.cross ?? {}).map(([brand, code]) => <div key={brand} className="min-w-0"><dt className="text-xs text-muted-foreground">{brand || "Belirtilmemiş"}</dt><dd className="break-words font-mono text-xs">{code}</dd></div>)}</dl> : <p className="text-xs text-muted-foreground">Çapraz referans bulunmuyor.</p>}
      </div>
      <div className="border-t pt-1"><AdminAddToCart productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)}/></div>
    </DialogContent>
  </Dialog>;
}
