import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Package, Search, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listProducts, productFilters, supplierNames, type ProductFilter } from "@/modules/admin/products";
import { money } from "@/modules/store/catalog";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);

export default async function Products({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await listProducts(params);
  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ filter: params.filter, q: params.q, sort: params.sort, dir: params.dir, page: undefined, ...changes })) if (value) next.set(key, value);
    return `/yonetim/urunler${next.size ? `?${next}` : ""}`;
  };
  const prev = data.page > 1 ? query({ page: String(data.page - 1) }) : null, next = data.page < data.pages ? query({ page: String(data.page + 1) }) : null;
  const filterHref = (filter: ProductFilter) => query({ filter: filter === "all" ? undefined : filter });

  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Ürünler</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ürünler</h1>
        <p className="text-muted-foreground">Ana ürün kataloğu. Her ürün bir marka ve parça numarasıdır; Başbuğ, Dinamik ve SETA kayıtları bu ürüne kaynak olarak bağlanır. Fiyat ve stok kaynaklardan gelir: stokta olan en ucuz kaynak satılır.</p>
      </div>
    </div>
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert/><AlertDescription>İşlem kaydedilemedi.</AlertDescription></Alert>}
    <Card>
      <CardHeader className="flex flex-col gap-4">
        <Tabs value={filterHref(data.filter)}><ScrollArea className="w-full pb-2">
          <TabsList variant="line" aria-label="Ürün filtresi">{(Object.keys(productFilters) as ProductFilter[]).map(filter =>
            <TabsTrigger key={filter} value={filterHref(filter)} nativeButton={false} render={<Link href={filterHref(filter)} scroll={false}/>}>
              {productFilters[filter].label}{data.counts && <Badge variant="secondary" className="tabular-nums">{number(data.counts[filter])}</Badge>}
            </TabsTrigger>)}</TabsList>
          <ScrollBar orientation="horizontal"/>
        </ScrollArea></Tabs>
        <form className="flex flex-wrap items-center gap-2" action="/yonetim/urunler">
          {(["filter", "sort", "dir"] as const).map(key => params[key] && <input key={key} type="hidden" name={key} value={params[key]}/>)}
          <InputGroup className="w-full sm:w-72"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon>
            <InputGroupInput name="q" aria-label="Parça numarası veya tedarikçi kodu" defaultValue={params.q} placeholder="Parça no veya tedarikçi kodu" maxLength={60}/></InputGroup>
          <Button type="submit">Ara</Button>
          {params.q && <Button variant="ghost" nativeButton={false} render={<Link href={query({ q: undefined })}/>}>Temizle</Button>}
        </form>
      </CardHeader>
      <Separator/>
      <CardContent>
        {data.products.length ? <Table server><caption className="sr-only">Ürünler</caption>
          <TableHeader><TableRow><TableHead sortKey="brand">Marka</TableHead><TableHead sortKey="code">Kod</TableHead><TableHead sortKey="name">Ürün</TableHead>
            <TableHead filter={{ param: "filter", options: (Object.keys(productFilters) as ProductFilter[]).filter(filter => filter !== "all").map(filter => ({ value: filter, label: productFilters[filter].label })) }}>Kaynaklar</TableHead><TableHead className="text-right">Satış fiyatı</TableHead><TableHead>Satan</TableHead></TableRow></TableHeader>
          <TableBody>{data.products.map(product => <TableRow key={product.id}>
            <TableCell className="max-w-32 truncate font-medium" title={product.brand_label}>{product.brand_label || product.brand}</TableCell>
            <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${product.id}`}>{product.code}</Link>
              {product.variant > 0 && <Badge variant="outline" className="ml-2">Ayrılmış</Badge>}</TableCell>
            <TableCell className="max-w-80 truncate" title={product.name ?? ""}>{product.name ?? <span className="text-muted-foreground">Ad yok</span>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{product.suppliers.length
              ? product.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>)
              : <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Satışta değil</Badge>}</div></TableCell>
            <TableCell className="text-right font-medium tabular-nums">{product.best_price ? money(product.best_price) : "—"}</TableCell>
            <TableCell>{product.best_supplier ? product.available
              ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{supplierNames[product.best_supplier]}</Badge>
              : <Badge variant="outline">Stok yok</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Package/></EmptyMedia><EmptyTitle>Ürün bulunamadı.</EmptyTitle>
            <EmptyDescription>{data.q ? "Aramayı veya filtreyi değiştirin." : <>Ürünler eşleştirme yenilemesiyle oluşur (<code>npm run products:match</code>).</>}</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-muted-foreground tabular-nums">{number(data.total)} ürün · Sayfa {number(data.page)} / {number(data.pages)}</span>
        <Pagination aria-label="Sayfalar" className="mx-0 w-auto"><PaginationContent>
          <PaginationItem>{prev ? <Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft data-icon="inline-start"/>Önceki</Button> : <Button variant="ghost" disabled><ChevronLeft data-icon="inline-start"/>Önceki</Button>}</PaginationItem>
          <PaginationItem>{next ? <Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end"/></Button> : <Button variant="ghost" disabled>Sonraki<ChevronRight data-icon="inline-end"/></Button>}</PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>
    </Card>
  </div>;
}
