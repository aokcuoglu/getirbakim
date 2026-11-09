import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Package, Search, TriangleAlert, X } from "lucide-react";
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
  const raw = await searchParams;
  const params = normalizeSearchParams(raw);
  const data = await listProducts({ ...params, brands: [raw.brand ?? []].flat(), categories: [raw.category ?? []].flat() });
  const categoryLabel = new Map(data.categoryOptions.map(category => [category.id, category.label]));
  const query = (changes: Record<string, string | string[] | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ filter: params.filter, brand: data.brands, category: data.categories, q: params.q, sort: params.sort, dir: params.dir, page: undefined, ...changes }))
      for (const item of [value ?? []].flat()) if (item) next.append(key, item);
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
          {data.brands.map(brand => <input key={`brand-${brand}`} type="hidden" name="brand" value={brand}/>)}
          {data.categories.map(category => <input key={`category-${category}`} type="hidden" name="category" value={category}/>)}
          <InputGroup className="w-full sm:w-72"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon>
            <InputGroupInput name="q" aria-label="Parça numarası veya tedarikçi kodu" defaultValue={params.q} placeholder="Parça no veya tedarikçi kodu" maxLength={60}/></InputGroup>
          <Button type="submit">Ara</Button>
          {params.q && <Button variant="ghost" nativeButton={false} render={<Link href={query({ q: undefined })}/>}>Temizle</Button>}
          {data.brands.map(brand => <Button key={brand} variant="secondary" aria-label={`Marka filtresini kaldır: ${brand}`} nativeButton={false}
            render={<Link href={query({ brand: data.brands.filter(item => item !== brand) })} scroll={false}/>}>Marka: {brand}<X data-icon="inline-end" aria-hidden="true"/></Button>)}
          {data.brands.length > 1 && <Button variant="ghost" nativeButton={false} render={<Link href={query({ brand: undefined })} scroll={false}/>}>Markaları temizle</Button>}
          {data.categories.map(category => <Button key={category} variant="secondary" aria-label={`Kategori filtresini kaldır: ${categoryLabel.get(category) ?? category}`} nativeButton={false}
            render={<Link href={query({ category: data.categories.filter(item => item !== category) })} scroll={false}/>}>Kategori: {categoryLabel.get(category) ?? category}<X data-icon="inline-end" aria-hidden="true"/></Button>)}
          {data.categories.length > 1 && <Button variant="ghost" nativeButton={false} render={<Link href={query({ category: undefined })} scroll={false}/>}>Kategorileri temizle</Button>}
        </form>
      </CardHeader>
      <Separator/>
      <CardContent>
        {data.products.length ? <Table server><caption className="sr-only">Ürünler</caption>
          <TableHeader><TableRow><TableHead sortKey="brand" filter={{ param: "brand", multiple: true, options: data.brandOptions.map(brand => ({ value: brand.label, label: brand.label, count: brand.count })) }}>Marka</TableHead><TableHead sortKey="code">Kod</TableHead><TableHead sortKey="name">Ürün</TableHead>
            <TableHead filter={{ param: "category", multiple: true, options: data.categoryOptions.map(category => ({ value: category.id, label: category.label, count: category.count })) }}>Kategori</TableHead>
            <TableHead filter={{ param: "filter", options: (Object.keys(productFilters) as ProductFilter[]).filter(filter => filter !== "all").map(filter => ({ value: filter, label: productFilters[filter].label })) }}>Kaynaklar</TableHead><TableHead className="text-right">Satış fiyatı</TableHead><TableHead>Satan</TableHead></TableRow></TableHeader>
          <TableBody>{data.products.map(product => <TableRow key={product.id}>
            <TableCell className="max-w-32 truncate font-medium" title={product.brand_label}>{product.brand_label || product.brand}</TableCell>
            <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${product.id}`}>{product.code}</Link>
              {product.variant > 0 && <Badge variant="outline" className="ml-2">Ayrılmış</Badge>}</TableCell>
            <TableCell className="max-w-80 truncate" title={product.name ?? ""}>{product.name ?? <span className="text-muted-foreground">Ad yok</span>}</TableCell>
            <TableCell className="max-w-48 truncate" title={product.categories.join(", ")}>{product.categories.length
              ? product.categories.join(", ") : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{product.suppliers.length
              ? product.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>)
              : <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Satışta değil</Badge>}</div></TableCell>
            <TableCell className="text-right font-medium tabular-nums">{product.best_price ? money(product.best_price) : "—"}</TableCell>
            <TableCell>{product.best_supplier ? product.available
              ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{supplierNames[product.best_supplier]}</Badge>
              : <Badge variant="outline">Stok yok</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Package/></EmptyMedia><EmptyTitle>Ürün bulunamadı.</EmptyTitle>
            <EmptyDescription>{data.q || data.brands.length || data.categories.length ? "Aramayı veya filtreyi değiştirin." : <>Ürünler eşleştirme yenilemesiyle oluşur (<code>npm run products:match</code>).</>}</EmptyDescription></EmptyHeader></Empty>}
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
