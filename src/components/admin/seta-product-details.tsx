"use client";

import { useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
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
  const cross = Object.entries(item.product_data.cross ?? {});
  return <Dialog>
    <DialogTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${item.code} ürün detayı`} title="Ürün detayını aç"/>}><ArrowUpRight aria-hidden="true"/></DialogTrigger>
    {/* Cart forms submit their server action instead of the surrounding supplier filter navigation. */}
    <DialogContent className="max-h-svh overflow-y-auto sm:max-w-xl" initialFocus={titleRef} onSubmit={event => event.stopPropagation()}>
      <DialogHeader>
        <DialogTitle ref={titleRef} tabIndex={-1}>{item.product_data.ac}</DialogTitle>
        <DialogDescription className="font-mono">{item.code} · SETA</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="flex min-w-0 flex-col gap-0.5"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium break-words">{value}</dd></div>)}</dl>
      <Separator/>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Çapraz referanslar</h3>
        {cross.length ? <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">{cross.map(([brand, code]) => <div key={brand} className="flex min-w-0 flex-col gap-0.5"><dt className="text-muted-foreground">{brand || "Belirtilmemiş"}</dt><dd className="font-mono break-words">{code}</dd></div>)}</dl> : <p className="text-muted-foreground">Çapraz referans bulunmuyor.</p>}
      </div>
      <DialogFooter><AdminAddToCart productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)}/></DialogFooter>
    </DialogContent>
  </Dialog>;
}
