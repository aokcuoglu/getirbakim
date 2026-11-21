import Image from "next/image";
import Link from "next/link";
import { Ban, ImageOff, Images, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SharedImageBlockDialog } from "@/components/admin/shared-image-block-dialog";
import { StatusBadge } from "@/components/admin/status-badge";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemMedia } from "@/components/ui/item";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatNumber } from "@/modules/admin/format";
import { listBlockedImages, listPlaceholderImages, listSharedImages, minPartsOptions } from "@/modules/admin/shared-images";

export default async function SharedImages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const [data, placeholders, blocks] = await Promise.all([listSharedImages(params), listPlaceholderImages(), listBlockedImages()]);
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
      <p className="text-muted-foreground">Birden çok parça numarasında kullanılan otomatik (zenginleştirme) görselleri. Çoğu gerçek ürün ailesi fotoğrafıdır. Yer tutucu, filigranlı veya yanlış bir görseli buradan engelleyebilirsiniz. Engellenen görsel onu kullanan bütün ürünlerde mağazada gizlenir; engel kaldırılınca geri gelir. Tek bir üründe gerçek fotoğraf yüklemek veya otomatik görseli gizlemek için ürüne girin.</p>
    </div>
    {placeholders.inUse.images > 0 && <Alert variant="warning"><TriangleAlert aria-hidden="true"/>
      <AlertTitle>{formatNumber(placeholders.inUse.images)} yer tutucu görsel temizlik bekliyor</AlertTitle>
      <AlertDescription>Bu görseller mağazada gizleniyor; zenginleştirme kaydı veya mağaza satırı temizlik ve senkronizasyondan sonra düşer. Ayrıntı için sayfanın altındaki yer tutucu listesine bakın.</AlertDescription></Alert>}
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
            <TableCell className="tabular-nums"><div className="flex flex-wrap items-center gap-2">
              {image.listed ? <>{image.store_rows > 0 && formatNumber(image.store_rows)}<StatusBadge tone="warning">Yer tutucu, mağazada gizli</StatusBadge></>
                : image.blocked ? <>{image.store_rows > 0 && formatNumber(image.store_rows)}<StatusBadge tone="warning" icon={Ban}>Engellendi, mağazada gizli</StatusBadge></>
                : image.store_rows === 0 ? <StatusBadge tone="neutral">Mağazada yok</StatusBadge> : formatNumber(image.store_rows)}</div></TableCell>
            <TableCell className="max-w-64 truncate" title={image.samples.join(", ")}>{image.samples.join(", ")}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/yonetim/ortak-gorseller/${image.image_id}${listQuery.size ? `?${new URLSearchParams({ from: listQuery.toString() })}` : ""}`}/>}>Ürünleri gör</Button>
              {!image.listed && <SharedImageBlockDialog imageId={image.image_id} blocked={image.blocked} label={`${image.host} görseli, ${formatNumber(image.parts)} parça`} note={image.block_note} sourceUrl={image.source_url}/>}
            </div></TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Images/></EmptyMedia><EmptyTitle>Bu eşikte ortak görsel yok.</EmptyTitle>
            <EmptyDescription>Eşiği veya kaynak filtresini değiştirin.</EmptyDescription></EmptyHeader>
            {data.host && <EmptyContent><Button variant="outline" nativeButton={false} render={<Link href={`/yonetim/ortak-gorseller${clearHost.size ? `?${clearHost}` : ""}`}/>}>Filtreyi temizle</Button></EmptyContent>}</Empty>}
      </CardContent>
      <CardFooter>
        <SupplierPagination base="/yonetim/ortak-gorseller" params={params} keys={["min", "host"]} page={data.page} pages={data.pages} capped={data.capped}/>
      </CardFooter>
    </Card>
    <Card>
      <CardHeader><CardTitle><h2>Engellenen görseller</h2></CardTitle>
        <CardDescription>Bu panelden engellenen görseller onları kullanan bütün ürünlerde mağazada gizlenir; zenginleştirme kaydı silinmez, engel kaldırılınca görsel geri gelir.</CardDescription></CardHeader>
      <CardContent>
        {blocks.length ? <Table><caption className="sr-only">Engellenen görseller</caption>
          <TableHeader><TableRow>
            <TableHead>Not</TableHead><TableHead>Kaynak</TableHead><TableHead>Engelleyen</TableHead><TableHead>Tarih</TableHead><TableHead>SHA-256</TableHead>
            <TableHead>Zenginleştirme kaydı</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{blocks.map(block => <TableRow key={block.sha256}>
            <TableCell className="max-w-80 whitespace-normal">{block.note || <span className="text-muted-foreground">Not yok</span>}</TableCell>
            <TableCell className="max-w-40 truncate" value={block.source_url ?? ""}>{block.source_url
              ? <a className="underline-offset-4 hover:underline" href={block.source_url} target="_blank" rel="noreferrer" title={block.source_url}>{block.source_url.split("/")[2] || block.source_url}<span className="sr-only"> (kaynak adresi, yeni sekmede açılır)</span></a>
              : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell>{block.created_by ?? <span className="text-muted-foreground">Bilinmiyor</span>}</TableCell>
            <TableCell className="tabular-nums" value={block.created_at.toISOString()}>{formatDate(block.created_at)}</TableCell>
            <TableCell className="font-mono text-xs break-all" value={block.sha256}>{block.sha256}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(block.donors)}</TableCell>
            <TableCell>{block.image_id
              ? <div className="flex flex-wrap gap-2">
                {block.donors > 0 && <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/yonetim/ortak-gorseller/${block.image_id}`}/>}>Ürünleri gör</Button>}
                <SharedImageBlockDialog imageId={block.image_id} blocked label={`SHA-256 ${block.sha256.slice(0, 12)}`} note={block.note} sourceUrl={block.source_url}/>
              </div>
              : <span className="text-muted-foreground">Görsel bu ortamda bulunmuyor</span>}</TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Ban/></EmptyMedia><EmptyTitle>Engellenen görsel yok.</EmptyTitle>
            <EmptyDescription>Yukarıdaki listede bir görseli &quot;Engelle&quot; ile mağazada gizleyebilirsiniz.</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle><h2>Yer tutucu listesi</h2></CardTitle>
        <CardDescription>{formatNumber(placeholders.entries.length)} yer tutucu görsel mağazada gizlenir. Bu liste panelden değiştirilmez; kod sabitinden gelir ve sürümle güncellenir. Notlar kaynak dilindedir.</CardDescription></CardHeader>
      <CardContent>
        {placeholders.entries.length ? <Table><caption className="sr-only">Yer tutucu listesi</caption>
          <TableHeader><TableRow>
            <TableHead>Kaynak</TableHead><TableHead>Not</TableHead><TableHead>SHA-256</TableHead>
            <TableHead>Zenginleştirme kaydı</TableHead><TableHead>Mağaza satırı</TableHead><TableHead>Durum</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{placeholders.entries.map(entry => <TableRow key={entry.sha256}>
            <TableCell>{entry.source}</TableCell>
            <TableCell className="max-w-80 whitespace-normal" lang="en">{entry.note}</TableCell>
            <TableCell className="font-mono text-xs break-all" value={entry.sha256}>{entry.sha256}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(entry.donors)}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(entry.store_rows)}</TableCell>
            <TableCell>{entry.state === "cleanup_pending" ? <StatusBadge tone="warning">Temizlik bekliyor</StatusBadge>
              : entry.state === "sync_pending" ? <StatusBadge tone="warning">Senkron bekliyor</StatusBadge>
              : entry.state === "clean" ? <StatusBadge tone="success">Temizlendi</StatusBadge>
              : <StatusBadge tone="neutral">Bu veritabanında kayıt yok</StatusBadge>}</TableCell>
            <TableCell>{entry.image_id && entry.donors > 0
              ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/yonetim/ortak-gorseller/${entry.image_id}`}/>}>Ürünleri gör</Button>
              : <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Images/></EmptyMedia><EmptyTitle>Yer tutucu listesi boş.</EmptyTitle></EmptyHeader></Empty>}
      </CardContent>
    </Card>
  </div>;
}
