import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, ExternalLink, GitFork, Info, Link2, Merge, Search, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { findMergeTargets, getMasterProduct, supplierNames } from "@/modules/admin/products";
import { money } from "@/modules/store/catalog";
import { mergeProducts, splitSource, undoSplitSource } from "../actions";

const date = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const kinds = { oem: "Ortak OEM numarası", cross: "Rakip kodu referansı", brand: "Muadil marka kararı" } as const;

export default async function MasterProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, query] = await Promise.all([params, searchParams.then(normalizeSearchParams)]);
  const data = await getMasterProduct(id);
  if (!data) notFound();
  const { product, sources, equivalents, merged, storeId } = data;
  const merge = await findMergeTargets(product.id, query.merge_q);
  const multiple = sources.length > 1;

  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/urunler"/>}>Ürünler</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>{product.code}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 max-w-3xl flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{product.name ?? product.code}</h1>
          <p className="text-muted-foreground">{product.brand_label || product.brand} · <span className="font-mono">{product.code}</span></p>
        </div>
        {storeId && <Button variant="outline" nativeButton={false} render={<Link href={`/urun/${storeId}`} target="_blank"/>}>Mağazada aç<ExternalLink data-icon="inline-end" aria-hidden="true"/></Button>}
      </div>
    </div>
    {query.split && <Alert variant="success"><CircleCheck/><AlertDescription>Kayıt ayrıldı ve <Link className="underline underline-offset-4" href={`/yonetim/urunler/${query.split}`}>ayrı bir ürün</Link> oldu; mağazada ayrı listeleniyor.</AlertDescription></Alert>}
    {query.joined && <Alert variant="success"><CircleCheck/><AlertDescription>Ayırma kaldırıldı; kayıt bu ürüne döndü. Mağazada bir sonraki eşleştirme yenilemesinde birleşir.</AlertDescription></Alert>}
    {query.merged && <Alert variant="success"><CircleCheck/><AlertDescription>Ürünler birleştirildi; tüm kaynaklar bu üründe ve mağazada tek ürün olarak satılıyor. Yanlışsa ilgili kaynağı “Geri al” ile ayırın.</AlertDescription></Alert>}
    {query.reset && <Alert variant="success"><CircleCheck/><AlertDescription>Kayıt kendi ürününe <Link className="underline underline-offset-4" href={`/yonetim/urunler/${query.reset}`}>geri döndü</Link>.</AlertDescription></Alert>}
    {query.error && <Alert variant="destructive" role="alert"><CircleAlert/><AlertDescription>İşlem kaydedilemedi.</AlertDescription></Alert>}
    {merged && <Alert variant="info"><Info/><AlertTitle>Bu ürün birleştirildi</AlertTitle>
      <AlertDescription>Kayıtları <Link className="underline underline-offset-4" href={`/yonetim/urunler/${merged.id}`}>{merged.brand_label} {merged.code}</Link> ürününe taşındı (marka eşleştirme kararı).</AlertDescription></Alert>}

    <Card>
      <CardHeader><CardTitle><h2>Ürün kimliği</h2></CardTitle>
        <CardDescription>Aynı marka anahtarı ve parça numarasına sahip tedarikçi kayıtları otomatik olarak bu ürüne bağlanır.</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Marka anahtarı</dt><dd className="font-mono">{product.brand}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Parça numarası</dt><dd className="font-mono">{product.part_number}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Tür</dt><dd>{product.variant > 0 ? <Badge variant="outline">Elle ayrılmış ürün</Badge> : "Otomatik eşleşme"}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Oluşturulma</dt><dd className="tabular-nums">{date(product.created_at)}</dd></div>
      </dl></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle><h2>Tedarikçi kaynakları</h2></CardTitle>
        <CardDescription>Mağaza stokta olan en ucuz kaynağı satar; eşitlikte ürünün kendi kaydı önce gelir. Kayıt bu ürün değilse “Ayır” deyin: ayrı bir ürün olur. Elle verilen kararları yenilemeler değiştirmez; “Geri al” kaydı kendi ürününe döndürür.</CardDescription></CardHeader>
      <CardContent>{sources.length ? <Table><caption className="sr-only">Tedarikçi kaynakları</caption>
        <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Kod</TableHead><TableHead>Tedarikçideki ad</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead>Stok</TableHead><TableHead>Bağlantı</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>{sources.map(source => <TableRow key={source.id}>
          <TableCell className="font-medium">{supplierNames[source.supplier] ?? source.supplier}</TableCell>
          <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/tedarikciler/${source.supplier}/urun/${source.id}`}>{source.code}</Link></TableCell>
          <TableCell className="max-w-72 truncate" title={source.name ?? ""}>{source.name ?? <span className="text-muted-foreground">—</span>}
            {source.brand_label && <span className="text-muted-foreground"> · {source.brand_label}</span>}</TableCell>
          <TableCell className="text-right tabular-nums">{source.price_kurus ? money(source.price_kurus) : "—"}</TableCell>
          <TableCell>{!source.saleable ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Satışta değil</Badge>
            : source.best ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Satılan</Badge>
            : <span className="text-muted-foreground">{source.stock_label ?? "—"}</span>}</TableCell>
          <TableCell>{source.method === "manual" ? <Badge variant="outline">Elle</Badge> : <span className="text-muted-foreground">Otomatik</span>}</TableCell>
          <TableCell>{source.method === "manual"
            ? <form action={undoSplitSource}><input type="hidden" name="item_id" value={source.id}/><input type="hidden" name="product_id" value={product.id}/><Button type="submit" variant="outline">Geri al</Button></form>
            : multiple && <form action={splitSource}><input type="hidden" name="item_id" value={source.id}/><input type="hidden" name="product_id" value={product.id}/><Button type="submit" variant="outline"><GitFork data-icon="inline-start" aria-hidden="true"/>Ayır</Button></form>}</TableCell>
        </TableRow>)}</TableBody></Table>
        : <Empty><EmptyHeader><EmptyTitle>Bağlı kaynak yok.</EmptyTitle><EmptyDescription>Bu ürünün tedarikçi kaydı kalmadı.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
    </Card>

    <Card id="birlestir">
      <CardHeader><CardTitle><h2>Başka ürünle birleştir</h2></CardTitle>
        <CardDescription>Otomatik eşleşmenin kaçırdığı aynı ürünü bulun: parça numarası veya tedarikçi koduyla arayın. Birleşince tüm kaynaklar tek üründe toplanır; Başbuğ&apos;un sattığı ürün kimliğini korur.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-center gap-2" action={`/yonetim/urunler/${product.id}#birlestir`}>
          <InputGroup className="w-full sm:w-72"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon>
            <InputGroupInput name="merge_q" aria-label="Birleştirilecek ürünü ara" defaultValue={query.merge_q ?? product.part_number} placeholder="Parça no veya kod" maxLength={60}/></InputGroup>
          <Button type="submit">Ara</Button>
        </form>
        {query.merge_q !== undefined && (merge.targets.length ? <Table><caption className="sr-only">Birleştirilebilecek ürünler</caption>
          <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead>Kaynaklar</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{merge.targets.map(target => <TableRow key={target.id}>
            <TableCell className="max-w-32 truncate font-medium">{target.brand_label}{!target.same_brand && <Badge variant="warning" className="ml-2"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Farklı marka</Badge>}</TableCell>
            <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${target.id}`}>{target.code}</Link></TableCell>
            <TableCell className="max-w-72 truncate" title={target.name ?? ""}>{target.name ?? "—"}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{target.suppliers.length ? target.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>) : <span className="text-muted-foreground">Satışta değil</span>}</div></TableCell>
            <TableCell><form action={mergeProducts}><input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="other_id" value={target.id}/>
              <Button type="submit" variant="outline"><Merge data-icon="inline-start" aria-hidden="true"/>Birleştir</Button></form></TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyTitle>{merge.q.length < 3 ? "En az 3 karakter girin." : "Ürün bulunamadı."}</EmptyTitle></EmptyHeader></Empty>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle><h2>Muadil ürünler</h2></CardTitle>
        <CardDescription>Aynı ürün değil, yerine kullanılabilecek ürünler: ortak OEM numarası, SETA gibi tedarikçilerin rakip kodu referansı veya “Muadil” marka kararı.</CardDescription></CardHeader>
      <CardContent>{equivalents.length ? <Table><caption className="sr-only">Muadil ürünler</caption>
        <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead>Kaynaklar</TableHead><TableHead>Bağlantı nedeni</TableHead></TableRow></TableHeader>
        <TableBody>{equivalents.map(item => <TableRow key={item.id}>
          <TableCell className="max-w-32 truncate font-medium">{item.brand_label}</TableCell>
          <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${item.id}`}>{item.code}</Link></TableCell>
          <TableCell className="max-w-72 truncate" title={item.name ?? ""}>{item.name ?? "—"}</TableCell>
          <TableCell><div className="flex flex-wrap gap-1">{item.suppliers.length ? item.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>) : <span className="text-muted-foreground">Satışta değil</span>}</div></TableCell>
          <TableCell className="text-muted-foreground">{kinds[item.kind]} · <span className="font-mono">{item.via_brand} {item.via_part}</span></TableCell>
        </TableRow>)}</TableBody></Table>
        : <Empty><EmptyHeader><EmptyMedia variant="icon"><Link2/></EmptyMedia><EmptyTitle>Muadil bulunamadı.</EmptyTitle></EmptyHeader></Empty>}</CardContent>
    </Card>
  </div>;
}
