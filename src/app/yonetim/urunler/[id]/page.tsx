import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, ExternalLink, GitFork, Info, Link2, Merge, Search, Unlink } from "lucide-react";
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
import { formatDateTime } from "@/modules/admin/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { linkEquivalent, mergeProducts, splitSource, undoSplitSource, unlinkEquivalent } from "../actions";

const kinds = { oem: "Ortak OEM numarası", cross: "Rakip kodu referansı", brand: "Muadil marka kararı", manual: "Elle muadil" } as const;

export default async function MasterProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, query] = await Promise.all([params, searchParams.then(normalizeSearchParams)]);
  // The merge search needs only the id; without merge_q it returns at once.
  const [data, merge] = await Promise.all([getMasterProduct(id), findMergeTargets(id, query.merge_q)]);
  if (!data) notFound();
  const { product, sources, equivalents, merged, storeId } = data;
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
    {query.split && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Kayıt ayrıldı ve <Link className="underline underline-offset-4" href={`/yonetim/urunler/${query.split}`}>ayrı bir ürün</Link> oldu; mağazada ayrı listeleniyor.</AlertDescription></Alert>}
    {query.joined && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Ayırma kaldırıldı; kayıt bu ürüne döndü. Mağazada bir sonraki eşleştirme yenilemesinde birleşir.</AlertDescription></Alert>}
    {query.merged && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Ürünler birleştirildi; tüm kaynaklar bu üründe ve mağazada tek ürün olarak satılıyor. Yanlışsa ilgili kaynağı “Geri al” ile ayırın.</AlertDescription></Alert>}
    {query.reset && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Kayıt kendi ürününe <Link className="underline underline-offset-4" href={`/yonetim/urunler/${query.reset}`}>geri döndü</Link>.</AlertDescription></Alert>}
    {query.linked && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Muadil olarak bağlandı; ürünler ayrı kalır, yenilemeler bu kararı korur.</AlertDescription></Alert>}
    {query.unlinked && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Muadil bağlantısı kaldırıldı; yenilemeler bu çifti yeniden bağlamaz.</AlertDescription></Alert>}
    {query.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>İşlem kaydedilemedi.</AlertDescription></Alert>}
    {merged && <Alert variant="info"><Info aria-hidden="true"/><AlertTitle>Bu ürün birleştirildi</AlertTitle>
      <AlertDescription>Kayıtları <Link className="underline underline-offset-4" href={`/yonetim/urunler/${merged.id}`}>{merged.brand_label} {merged.code}</Link> ürününe taşındı (marka eşleştirme kararı).</AlertDescription></Alert>}

    <Card>
      <CardHeader><CardTitle><h2>Ürün kimliği</h2></CardTitle>
        <CardDescription>Aynı marka anahtarı ve parça numarasına sahip tedarikçi kayıtları otomatik olarak bu ürüne bağlanır.</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Marka anahtarı</dt><dd className="font-mono">{product.brand}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Parça numarası</dt><dd className="font-mono">{product.part_number}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Tür</dt><dd>{product.variant > 0 ? <Badge variant="outline">Elle ayrılmış ürün</Badge> : "Otomatik eşleşme"}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Oluşturulma</dt><dd className="tabular-nums">{formatDateTime(product.created_at, { year: true })}</dd></div>
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
          <TableCell>{!source.saleable ? <StatusBadge tone="warning">Satışta değil</StatusBadge>
            : source.best ? <StatusBadge tone="success">Satılan</StatusBadge>
            : <span className="text-muted-foreground">{source.stock_label ?? "—"}</span>}</TableCell>
          <TableCell>{source.method === "manual" ? <Badge variant="outline">Elle</Badge> : <span className="text-muted-foreground">Otomatik</span>}</TableCell>
          <TableCell>{source.method === "manual"
            ? <form action={undoSplitSource}><input type="hidden" name="item_id" value={source.id}/><input type="hidden" name="product_id" value={product.id}/><SubmitButton variant="outline">Geri al</SubmitButton></form>
            : multiple && <form action={splitSource}><input type="hidden" name="item_id" value={source.id}/><input type="hidden" name="product_id" value={product.id}/><SubmitButton variant="outline" icon={<GitFork data-icon="inline-start" aria-hidden="true"/>}>Ayır</SubmitButton></form>}</TableCell>
        </TableRow>)}</TableBody></Table>
        : <Empty><EmptyHeader><EmptyTitle>Bağlı kaynak yok.</EmptyTitle><EmptyDescription>Bu ürünün tedarikçi kaydı kalmadı.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
    </Card>

    <Card id="birlestir">
      <CardHeader><CardTitle><h2>Başka ürünle birleştir</h2></CardTitle>
        <CardDescription>Otomatik eşleşmenin kaçırdığı aynı ürünü bulun: parça numarası veya tedarikçi koduyla arayın. Birleşince tüm kaynaklar tek üründe toplanır; Başbuğ&apos;un sattığı ürün kimliğini korur. Farklı marka aynı ürün değildir: yerine kullanılabiliyorsa “Muadil” ile bağlayın.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-center gap-2" action={`/yonetim/urunler/${product.id}#birlestir`}>
          <InputGroup className="w-full sm:w-72"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon>
            <InputGroupInput name="merge_q" aria-label="Birleştirilecek ürünü ara" defaultValue={query.merge_q ?? product.part_number} placeholder="Parça no veya kod" maxLength={60}/></InputGroup>
          <Button type="submit">Ara</Button>
        </form>
        {query.merge_q !== undefined && (merge.targets.length ? <Table><caption className="sr-only">Birleştirilebilecek ürünler</caption>
          <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead>Kaynaklar</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{merge.targets.map(target => <TableRow key={target.id}>
            <TableCell className="max-w-32 truncate font-medium">{target.brand_label}{!target.same_brand && <StatusBadge tone="warning" className="ml-2">Farklı marka</StatusBadge>}</TableCell>
            <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${target.id}`}>{target.code}</Link></TableCell>
            <TableCell className="max-w-72 truncate" title={target.name ?? ""}>{target.name ?? "—"}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{target.suppliers.length ? target.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>) : <span className="text-muted-foreground">Satışta değil</span>}</div></TableCell>
            <TableCell><div className="flex flex-wrap justify-end gap-2">
              {target.equivalent ? <StatusBadge tone="info" icon={Link2}>Muadil</StatusBadge>
                : <form action={linkEquivalent}><input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="other_id" value={target.id}/>
                  <SubmitButton variant={target.same_brand ? "outline" : "default"} icon={<Link2 data-icon="inline-start" aria-hidden="true"/>}>Muadil</SubmitButton></form>}
              <form action={mergeProducts}><input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="other_id" value={target.id}/>
                <SubmitButton variant="outline" icon={<Merge data-icon="inline-start" aria-hidden="true"/>}>Birleştir</SubmitButton></form>
            </div></TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyTitle>{merge.q.length < 3 ? "En az 3 karakter girin." : "Ürün bulunamadı."}</EmptyTitle></EmptyHeader></Empty>)}
      </CardContent>
    </Card>

    <Card id="muadil">
      <CardHeader><CardTitle><h2>Muadil ürünler</h2></CardTitle>
        <CardDescription>Aynı ürün değil, yerine kullanılabilecek ürünler: ortak OEM numarası, SETA gibi tedarikçilerin rakip kodu referansı, “Muadil” marka kararı veya elle bağlantı. Yanlış bağlantıyı “Kaldır” ile çıkarın; yenilemeler yeniden eklemez.</CardDescription></CardHeader>
      <CardContent>{equivalents.length ? <Table><caption className="sr-only">Muadil ürünler</caption>
        <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead>Kaynaklar</TableHead><TableHead>Bağlantı nedeni</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>{equivalents.map(item => <TableRow key={item.id}>
          <TableCell className="max-w-32 truncate font-medium">{item.brand_label}</TableCell>
          <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${item.id}`}>{item.code}</Link></TableCell>
          <TableCell className="max-w-72 truncate" title={item.name ?? ""}>{item.name ?? "—"}</TableCell>
          <TableCell><div className="flex flex-wrap gap-1">{item.suppliers.length ? item.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>) : <span className="text-muted-foreground">Satışta değil</span>}</div></TableCell>
          <TableCell className="text-muted-foreground">{kinds[item.kind]}{item.kind !== "manual" && <> · <span className="font-mono">{item.via_brand} {item.via_part}</span></>}</TableCell>
          <TableCell><form action={unlinkEquivalent}><input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="other_id" value={item.id}/>
            <SubmitButton variant="outline" icon={<Unlink data-icon="inline-start" aria-hidden="true"/>}>Kaldır</SubmitButton></form></TableCell>
        </TableRow>)}</TableBody></Table>
        : <Empty><EmptyHeader><EmptyMedia variant="icon"><Link2/></EmptyMedia><EmptyTitle>Muadil bulunamadı.</EmptyTitle></EmptyHeader></Empty>}</CardContent>
    </Card>
  </div>;
}
