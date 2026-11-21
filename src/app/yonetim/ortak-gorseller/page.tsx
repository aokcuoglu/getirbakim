import Image from "next/image";
import Link from "next/link";
import { ImageOff, Images } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { StatusBadge } from "@/components/admin/status-badge";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemMedia } from "@/components/ui/item";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/modules/admin/format";
import { listSharedImages, minPartsOptions } from "@/modules/admin/shared-images";

export default async function SharedImages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await listSharedImages(params);
  const tabHref = (min: string) => {
    const query = new URLSearchParams({ min });
    for (const key of ["host", "sort", "dir"] as const) if (params[key]) query.set(key, params[key]);
    return `/yonetim/ortak-gorseller?${query}`;
  };
  const listQuery = new URLSearchParams();
  for (const key of ["min", "host", "sort", "dir", "page"] as const) if (params[key]) listQuery.set(key, params[key]);
  const clearHost = new URLSearchParams();
  for (const key of ["min", "sort", "dir"] as const) if (params[key]) clearHost.set(key, params[key]);

  return <div className="flex flex-col gap-6">
    <div className="flex min-w-0 max-w-3xl flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Ortak görseller</h1>
      <p className="text-muted-foreground">Birden çok parça numarasında kullanılan otomatik (zenginleştirme) görselleri. Çoğu gerçek ürün ailesi fotoğrafıdır; yer tutucu veya filigranlı olanlarda ürüne girip gerçek fotoğraf yükleyin ya da otomatik görseli gizleyin.</p>
    </div>
    <Card>
      <CardHeader>
        <Tabs value={tabHref(data.min)}><ScrollArea className="w-full pb-2">
          <TabsList variant="line" aria-label="Parça eşiği">{Object.keys(minPartsOptions).map(min =>
            <TabsTrigger key={min} value={tabHref(min)} nativeButton={false} render={<Link href={tabHref(min)} scroll={false}/>}>{min}+ parça</TabsTrigger>)}</TabsList>
          <ScrollBar orientation="horizontal"/>
        </ScrollArea></Tabs>
      </CardHeader>
      <CardContent>
        {data.images.length ? <Table server><caption className="sr-only">Ortak görseller</caption>
          <TableHeader><TableRow>
            <TableHead>Görsel</TableHead>
            <TableHead sortKey="host" filter={{ param: "host", options: data.hostOptions.map(host => ({ value: host.host, label: host.host || "Bilinmiyor", count: host.count })) }}>Kaynak</TableHead>
            <TableHead>Üretici</TableHead>
            <TableHead sortKey="parts">Parça</TableHead>
            <TableHead sortKey="rows">Zenginleştirme kaydı</TableHead>
            <TableHead>Mağaza satırı</TableHead>
            <TableHead>Örnek ürünler</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.images.map(image => <TableRow key={image.image_id}>
            <TableCell><ItemMedia variant="image" className="size-16">{image.store_rows === 0
              ? <ImageOff className="text-muted-foreground" role="img" aria-label="Mağazada gösterilmiyor"/>
              : <Image src={`/api/product-media/${image.image_id}`} alt={`Ortak görsel, ${image.host}`} width={64} height={64} unoptimized/>}</ItemMedia></TableCell>
            <TableCell className="max-w-40 truncate" title={image.source_url}>{image.host}</TableCell>
            <TableCell className="max-w-48 truncate" title={image.manufacturers.join(", ")}>{image.manufacturers.length
              ? <>{image.manufacturers.slice(0, 2).join(", ")}{image.manufacturers.length > 2 && ` +${image.manufacturers.length - 2}`}</>
              : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(image.parts)}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(image.donors)}</TableCell>
            <TableCell className="tabular-nums">{image.store_rows === 0 ? <StatusBadge tone="neutral">Mağazada yok</StatusBadge> : formatNumber(image.store_rows)}</TableCell>
            <TableCell className="max-w-64 truncate" title={image.samples.join(", ")}>{image.samples.join(", ")}</TableCell>
            <TableCell><Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/yonetim/ortak-gorseller/${image.image_id}${listQuery.size ? `?${new URLSearchParams({ from: listQuery.toString() })}` : ""}`}/>}>Ürünleri gör</Button></TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Images/></EmptyMedia><EmptyTitle>Bu eşikte ortak görsel yok.</EmptyTitle>
            <EmptyDescription>Eşiği veya kaynak filtresini değiştirin.</EmptyDescription></EmptyHeader>
            {data.host && <EmptyContent><Button variant="outline" nativeButton={false} render={<Link href={`/yonetim/ortak-gorseller${clearHost.size ? `?${clearHost}` : ""}`}/>}>Filtreyi temizle</Button></EmptyContent>}</Empty>}
      </CardContent>
      <CardFooter>
        <SupplierPagination base="/yonetim/ortak-gorseller" params={params} keys={["min", "host"]} page={data.page} pages={data.pages} capped={data.capped}/>
      </CardFooter>
    </Card>
  </div>;
}
