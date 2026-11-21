import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ImageOff } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { StatusBadge } from "@/components/admin/status-badge";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { ItemMedia } from "@/components/ui/item";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/modules/admin/format";
import { productTabHref } from "@/modules/admin/product-tabs";
import { supplierNames } from "@/modules/admin/products";
import { loadSharedImage } from "@/modules/admin/shared-images";

export default async function SharedImage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const search = normalizeSearchParams(query);
  const data = await loadSharedImage(id, search);
  if (!data) notFound();
  const { header } = data;

  return <div className="flex flex-col gap-6">
    <div><Button variant="ghost" nativeButton={false} render={<Link href="/yonetim/ortak-gorseller"/>}><ChevronLeft data-icon="inline-start" aria-hidden="true"/>Ortak görseller</Button></div>
    <Card size="sm"><CardContent className="flex flex-wrap items-start gap-4">
      <ItemMedia variant="image" className="size-40">{header.store_rows === 0
        ? <ImageOff className="text-muted-foreground" aria-label="Mağazada gösterilmiyor"/>
        : <Image src={`/api/product-media/${header.image_id}`} alt="" width={160} height={160} unoptimized/>}</ItemMedia>
      <dl className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
        {([["Kaynak", header.host], ["Üretici", header.manufacturers.join(", ") || "—"], ["Parça", formatNumber(header.parts)],
          ["Kayıt", formatNumber(header.donors)], ["Mağaza satırı", formatNumber(header.store_rows)]] as const).map(([label, value]) =>
          <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="truncate tabular-nums" title={value}>{value}</dd></div>)}
        <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Kaynak adresi</dt>
          <dd className="truncate"><a className="underline-offset-4 hover:underline" href={header.source_url} target="_blank" rel="noreferrer" title={header.source_url}>{header.source_url}</a></dd></div>
      </dl>
    </CardContent></Card>
    <Card>
      <CardContent>
        <Table server><caption className="sr-only">Görseli gösteren ürünler</caption>
          <TableHeader><TableRow>
            <TableHead sortKey="brand">Marka</TableHead><TableHead sortKey="code">Kod</TableHead><TableHead sortKey="name">Ürün</TableHead>
            <TableHead>Tedarikçi</TableHead><TableHead>Mağaza</TableHead><TableHead>Görsel durumu</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.rows.map(row => <TableRow key={row.supplier_item_id}>
            <TableCell className="max-w-32 truncate" title={row.supplier_brand}>{row.supplier_brand}</TableCell>
            <TableCell className="font-mono">{row.supplier_code}</TableCell>
            <TableCell className="max-w-80 truncate" title={row.name ?? ""}>{row.name ?? <span className="text-muted-foreground">Ad yok</span>}</TableCell>
            <TableCell><Badge variant="secondary">{supplierNames[row.supplier] ?? row.supplier}</Badge></TableCell>
            <TableCell>{row.in_store ? <StatusBadge tone="success">Mağazada</StatusBadge> : <StatusBadge tone="neutral">Mağazada yok</StatusBadge>}</TableCell>
            <TableCell>{row.uploaded ? <StatusBadge tone="info">Yönetici yükledi</StatusBadge>
              : row.hidden ? <StatusBadge tone="warning">Otomatik görsel gizli</StatusBadge>
              : <StatusBadge tone="neutral">Ortak görsel gösteriliyor</StatusBadge>}</TableCell>
            <TableCell>{row.product_id
              ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={productTabHref(row.product_id, "gorseller")}/>}>Görselleri yönet</Button>
              : <span className="text-muted-foreground">Eşleşmemiş</span>}</TableCell>
          </TableRow>)}</TableBody></Table>
      </CardContent>
      <CardFooter>
        <SupplierPagination base={`/yonetim/ortak-gorseller/${header.image_id}`} params={search} keys={[]} page={data.page} pages={data.pages} capped={data.capped}/>
      </CardFooter>
    </Card>
  </div>;
}
