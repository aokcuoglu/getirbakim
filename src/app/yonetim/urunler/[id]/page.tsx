import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ExternalLink, EyeOff, GitFork, History, Info, Link2, Merge, Pencil, Search, Tag, TriangleAlert, Unlink } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { findEquivalentTargets, findMergeTargets, getMasterProduct, getProductHistory, supplierNames } from "@/modules/admin/products";
import { overrideValueText, productOverrideFields, productOverrideLabels, type ProductOverrideField } from "@/modules/admin/product-override-fields";
import { productTab, productTabHref, visibleProductTabs } from "@/modules/admin/product-tabs";
import { ProductTabAnchor } from "@/components/admin/product-tab-anchor";
import { ProductPriceForm } from "@/components/admin/product-price-form";
import { ProductPricingDialog } from "@/components/admin/product-pricing-dialog";
import { getStoreCategories } from "@/modules/store/categories";
import { categoryPath } from "@/modules/store/category-tree";
import { ProductOverrideForm } from "@/components/admin/product-override-form";
import { ProductImagesCard } from "@/components/admin/product-images-card";
import { imageHistoryValue, productImageChangeLabels } from "@/modules/admin/product-image-store";
import { ProductReferencesCard } from "@/components/admin/product-references-card";
import { productReferenceChangeLabels, referenceHistoryValue } from "@/modules/admin/product-reference-fields";
import { ProductSpecsCard } from "@/components/admin/product-specs-card";
import { productSpecChangeLabels, specHistoryValue } from "@/modules/admin/product-spec-fields";
import { ProductFitmentsCard } from "@/components/admin/product-fitments-card";
import { fitmentBatchLabels, fitmentBatchSummary, fitmentHistoryValue, isFitmentChange, productFitmentChangeLabels } from "@/modules/admin/product-fitment-fields";
import { ProductFitmentBatchUndo } from "@/components/admin/product-fitment-batch-undo";
import { fitmentVehicleNames } from "@/modules/admin/product-fitment-store";
import { db } from "@/lib/db";
import { automaticVersion } from "@/modules/admin/product-override-store";
import { money } from "@/modules/store/catalog";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { fitmentSourceLabel } from "@/modules/admin/product-label";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { linkEquivalent, mergeProducts, splitSource, undoSplitSource, unlinkEquivalent } from "../actions";
import { productIdPath } from "@/modules/seo/product-id";

const equivalentVia = { code: "Parça no / kod", enrichment: "Zenginleştirme OEM", oem: "OEM numarası", reference: "Elle referans" } as const;
const kinds = { oem: "Ortak OEM numarası", cross: "Rakip kodu referansı", brand: "Muadil marka kararı", manual: "Elle muadil" } as const;

export default async function MasterProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, query] = await Promise.all([params, searchParams.then(normalizeSearchParams)]);
  const data = await getMasterProduct(id);
  if (!data) notFound();
  const { product, sources, equivalents, merged, storeId, override, hasReferences, hasSpecs, hasFitments, brands } = data;
  const tab = productTab(query.tab, Boolean(merged));
  // Only the open tab's data is read: the merge and equivalent searches need just the id (without a query they return at once).
  // The history (#816) is paged by `?page=`; `?toplu=` lists one bulk fitment change's rows.
  const batch = query.toplu && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.toplu) ? query.toplu : null;
  // The history page "Ayrıntı" was opened from (`?geri=`): "Tüm geçmişe dön" goes back to it.
  const backPage = batch && /^[1-9]\d{0,5}$/.test(query.geri ?? "") ? query.geri : undefined;
  const [merge, equivalentSearch, storeCategories, history] = await Promise.all([
    tab === "eslestirme" ? findMergeTargets(id, query.merge_q) : null,
    tab === "eslestirme" ? findEquivalentTargets(id, query.eq_q) : null,
    tab === "bilgiler" || tab === "gecmis" ? getStoreCategories() : [],
    tab === "gecmis" ? getProductHistory(id, { page: Number(query.page) || 1, batch }) : null,
  ]);
  // Fitment history stores the vehicle type id: the names of the ones on the page (a bulk line's first types), in one query.
  // Only fitment lines hold type ids (a price line's sample is its price).
  const vehicleNames = history ? await fitmentVehicleNames(db, history.entries.flatMap(entry => isFitmentChange(entry.field) || entry.field === "fitment_copied"
    ? [...entry.sample, entry.old_value, entry.new_value] : []).filter(value => value !== null)) : new Map<string, string>();
  const multiple = sources.length > 1;
  const edit = override.override;
  // Category choices as their path in the store tree ("Fren sistemi › Balata").
  const categoryLabels = new Map(storeCategories.map(category => [String(category.id), categoryPath(storeCategories, category.id).map(node => node.name).join(" › ")]));
  const categoryOptions = [...categoryLabels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "tr"));
  // A saved store brand stays choosable after its master brand was merged away or renamed (the edit keeps the name).
  const brandOptions = [...edit?.brand && !brands.includes(edit.brand) ? [{ value: edit.brand, label: `${edit.brand} (ana marka listesinde yok)` }] : [],
    ...brands.map(name => ({ value: name, label: name }))];
  // A history value as the admin knows it: category names, published/hidden, lira, Istanbul times, NULL as the automatic value.
  const historyValue = (field: string, value: string | null) => imageHistoryValue(field, value) ?? referenceHistoryValue(field, value) ?? specHistoryValue(field, value) ?? fitmentHistoryValue(field, value, vehicleNames) ?? (value === null ? <StatusBadge tone="neutral">Otomatik</StatusBadge>
    : field === "category_id" ? categoryLabels.get(value) ?? value
    : productOverrideFields.includes(field as ProductOverrideField) ? overrideValueText(value, field as ProductOverrideField) : value);
  // The price form's preview compares campaign times (Istanbul wall clock) with the time of this render.
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date()).replace(" ", "T");
  const fixed = edit?.price_kurus ?? null;

  const identity = <Card>
    <CardHeader><CardTitle><h2>Ürün kimliği</h2></CardTitle>
      <CardDescription>Aynı marka anahtarı ve parça numarasına sahip tedarikçi kayıtları otomatik olarak bu ürüne bağlanır.</CardDescription></CardHeader>
    <CardContent><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Marka anahtarı</dt><dd className="font-mono">{product.brand}</dd></div>
      <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Parça numarası</dt><dd className="font-mono">{product.part_number}</dd></div>
      <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Tür</dt><dd>{product.variant > 0 ? <Badge variant="outline">Elle ayrılmış ürün</Badge> : "Otomatik eşleşme"}</dd></div>
      <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Oluşturulma</dt><dd className="tabular-nums">{formatDateTime(product.created_at, { year: true })}</dd></div>
    </dl></CardContent>
  </Card>;

  // The code alone when it starts with the brand already (#888).
  const brand = product.brand_label || product.brand || "";
  const label = fitmentSourceLabel(brand, product.code);

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{product.name ?? product.code}</h1>
        <p className="text-muted-foreground">{label === product.code ? null : <>{brand} · </>}<span className="font-mono">{product.code}</span></p>
        {(edit || hasReferences || hasSpecs || hasFitments) && <div className="flex flex-wrap gap-2">
          {edit?.hidden && <StatusBadge tone="warning" icon={EyeOff}>Mağazada gizli</StatusBadge>}
          <Badge variant="info"><Pencil data-icon="inline-start" aria-hidden="true"/>Elle düzenlendi</Badge>
        </div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/yonetim/urunler"/>}><ArrowLeft data-icon="inline-start" aria-hidden="true"/>Ürünlere dön</Button>
        {storeId && <Button variant="outline" nativeButton={false} render={<Link href={productIdPath(storeId)} target="_blank"/>}>Mağazada aç<ExternalLink data-icon="inline-end" aria-hidden="true"/></Button>}
      </div>
    </div>
    {query.split && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Kayıt ayrıldı ve <Link className="underline underline-offset-4" href={`/yonetim/urunler/${query.split}`}>ayrı bir ürün</Link> oldu; mağazada ayrı listeleniyor.</AlertDescription></Alert>}
    {query.joined && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Ayırma kaldırıldı; kayıt bu ürüne döndü. Mağazada bir sonraki eşleştirme yenilemesinde birleşir.</AlertDescription></Alert>}
    {query.merged && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Ürünler birleştirildi; tüm kaynaklar bu üründe ve mağazada tek ürün olarak satılıyor. Yanlışsa ilgili kaynağı “Geri al” ile ayırın.</AlertDescription></Alert>}
    {query.merged === "hidden" && <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>Birleşen ürün mağazada gizliydi; gizlilik bu ürüne taşındı ve ürün artık mağazada görünmüyor. Satışa açmak için “Mağazada yayında”yı açıp kaydedin.</AlertDescription></Alert>}
    {query.merged && query.oem === "hidden" && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>Birleşen üründen tedarikçi OEM alanı gizliliği taşındı; tedarikçi OEM numaraları mağazada görünmüyor. “Referans numaraları”ndan yeniden gösterebilirsiniz.</AlertDescription></Alert>}
    {query.merged && query.images && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{query.images === "kept"
      ? "Birleşen ürünün görselleri, bu üründe görsel olduğu için taşınmadı."
      : `${Number(query.images) || 0} görsel birleşen üründen taşındı; birleştirme geri alınırsa kaldırılır.`}</AlertDescription></Alert>}
    {query.merged && Number(query.refs) > 0 && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{Number(query.refs)} referans numarası birleşen üründen taşındı; birleştirme geri alınırsa kaldırılır.</AlertDescription></Alert>}
    {query.merged && Number(query.specs) > 0 && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{Number(query.specs)} teknik özellik birleşen üründen taşındı; birleştirme geri alınırsa kaldırılır.</AlertDescription></Alert>}
    {query.merged && Number(query.fitments) > 0 && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{formatNumber(Number(query.fitments))} araç uyumu kararı birleşen üründen taşındı; birleştirme geri alınırsa kaldırılır.</AlertDescription></Alert>}
    {query.reset && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Kayıt kendi ürününe <Link className="underline underline-offset-4" href={`/yonetim/urunler/${query.reset}`}>geri döndü</Link>.</AlertDescription></Alert>}
    {query.linked && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Muadil olarak bağlandı; ürünler ayrı kalır, yenilemeler bu kararı korur.</AlertDescription></Alert>}
    {query.unlinked && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Muadil bağlantısı kaldırıldı; yenilemeler bu çifti yeniden bağlamaz.</AlertDescription></Alert>}
    {query.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>İşlem kaydedilemedi.</AlertDescription></Alert>}
    {merged && <Alert variant="info"><Info aria-hidden="true"/><AlertTitle>Bu ürün birleştirildi</AlertTitle>
      <AlertDescription>Kayıtları <Link className="underline underline-offset-4" href={`/yonetim/urunler/${merged.id}`}>{fitmentSourceLabel(merged.brand_label, merged.code)}</Link> ürününe taşındı (marka eşleştirme kararı).</AlertDescription></Alert>}
    {edit?.hidden && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>Mağazada gizli</AlertTitle>
      <AlertDescription>Ürün mağazada, sepette, bayi API&apos;sinde ve bakım setlerinde görünmez; kaynaklar satışa kapalı görünür.</AlertDescription></Alert>}

    <Tabs value={tab}><ScrollArea className="w-full pb-2">
      <TabsList variant="line" aria-label="Ürün bölümleri">{visibleProductTabs(Boolean(merged)).map(item =>
        <TabsTrigger key={item.key} value={item.key} nativeButton={false} render={<Link href={productTabHref(product.id, item.key, { merged: Boolean(merged) })} scroll={false}/>}>{item.label}</TabsTrigger>)}</TabsList>
      <ScrollBar orientation="horizontal"/>
    </ScrollArea></Tabs>
    <Suspense fallback={null}><ProductTabAnchor id={product.id} tab={tab} merged={Boolean(merged)}/></Suspense>

    {tab === "bilgiler" && <>
    {!merged && <Card id="magaza">
      <CardHeader><CardTitle><h2>Mağaza bilgileri</h2></CardTitle>
        <CardDescription>Elle girilen değer tedarikçi ve zenginleştirme verisinin yerine geçer; tedarikçi güncellemeleri ve yenilemeler onu değiştirmez. Boş bırakılan alan otomatik kaynaktan gelir.</CardDescription></CardHeader>
      <CardContent>
        <ProductOverrideForm productId={product.id} values={edit && { name: edit.name, description: edit.description, short_description: edit.short_description, seo_title: edit.seo_title,
          seo_description: edit.seo_description, category_id: edit.category_id, hidden: edit.hidden, brand: edit.brand, part_number: edit.part_number }}
          version={edit?.version ?? automaticVersion} categories={categoryOptions} brands={brandOptions}
          automatic={{ name: override.automatic.name ?? product.code, description: override.automatic.description,
            category: override.automatic.categories.map(category => categoryLabels.get(String(category.id)) ?? category.name).join(", ") || null,
            brand: override.automatic.brand ?? "", partNumber: override.automatic.code ?? product.code }}/>
      </CardContent>
    </Card>}

    {identity}
    </>}

    {tab === "fiyat" && <>
    {!merged && <Card id="fiyat">
      <CardHeader><CardTitle><h2>Fiyat</h2></CardTitle>
        <CardDescription>Sabit fiyat formülün yerine, kampanya fiyatı belirlenen süre boyunca normal fiyatın altında tüm kaynaklara uygulanır. Tedarikçi verisi eksik kaynak satışa açılmaz; maliyet altı fiyat uyarıyla kaydedilir.</CardDescription></CardHeader>
      <CardContent>
        <ProductPriceForm productId={product.id} version={edit?.version ?? automaticVersion} now={now}
          values={edit && { price_kurus: edit.price_kurus, sale_price_kurus: edit.sale_price_kurus, sale_from: edit.sale_from, sale_until: edit.sale_until }}
          sources={sources.filter(source => source.saleable).map(source => ({ id: source.id, code: source.code, available: source.available,
            auto: source.auto_price, cost: source.cost_kurus, vat: source.vat_percent }))}/>
      </CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle><h2>Tedarikçi kaynakları</h2></CardTitle>
        <CardDescription>Mağaza stokta olan en ucuz kaynağı satar; fiyat eşitse maliyeti düşük olan, o da eşitse ürünün kendi kaydı önce gelir. Kayıt bu ürün değilse “Ayır” deyin: ayrı bir ürün olur. Elle verilen kararları yenilemeler değiştirmez; “Geri al” kaydı kendi ürününe döndürür.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">{edit && multiple && <Alert variant="warning"><TriangleAlert aria-hidden="true"/>
        <AlertDescription>Bu ürünün elle düzenlenmiş mağaza bilgileri veya fiyatı{edit.hidden ? " (mağazada gizli)" : ""} var. “Ayır” ile çıkan kayıt bu düzenlemeleri taşımaz{edit.hidden ? " ve mağazada yeniden görünür" : ""}.</AlertDescription></Alert>}
        {sources.length ? <Table><caption className="sr-only">Tedarikçi kaynakları</caption>
        <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Kod</TableHead><TableHead>Tedarikçideki ad</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead>Stok</TableHead><TableHead>Bağlantı</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>{sources.map(source => <TableRow key={source.id}>
          <TableCell className="font-medium">{supplierNames[source.supplier] ?? source.supplier}</TableCell>
          <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/tedarikciler/${source.supplier}/urun/${source.id}`}>{source.code}</Link></TableCell>
          <TableCell className="max-w-72 truncate" title={source.name ?? ""}>{source.name ?? <span className="text-muted-foreground">—</span>}
            {source.brand_label && <span className="text-muted-foreground"> · {source.brand_label}</span>}</TableCell>
          <TableCell className="text-right tabular-nums"><div className="flex flex-col items-end gap-1">{source.price_kurus ? money(source.price_kurus) : "—"}
            {(source.price_kind || source.below_cost) && <div className="flex flex-wrap justify-end gap-1">
              {source.price_kind === "fixed" && <StatusBadge tone="info" icon={Pencil}>Sabit fiyat</StatusBadge>}
              {source.price_kind === "sale" && <StatusBadge tone="success" icon={Tag}>Kampanya</StatusBadge>}
              {source.below_cost && <StatusBadge tone="warning">Maliyet altı</StatusBadge>}
            </div>}</div></TableCell>
          <TableCell>{!source.saleable ? <StatusBadge tone="warning">Satışta değil</StatusBadge>
            : source.best ? <StatusBadge tone="success">Satılan</StatusBadge>
            : <span className="text-muted-foreground">{source.stock_label ?? "—"}</span>}</TableCell>
          <TableCell>{source.method === "manual" ? <Badge variant="outline">Elle</Badge> : <span className="text-muted-foreground">Otomatik</span>}</TableCell>
          <TableCell><div className="flex flex-wrap justify-end gap-2">
            {source.pricing && <ProductPricingDialog id={source.id} code={source.code} cost={source.cost} pricing={source.pricing} fixedPrice={fixed}/>}
            {source.method === "manual"
            ? <form action={undoSplitSource}><input type="hidden" name="item_id" value={source.id}/><input type="hidden" name="product_id" value={product.id}/><SubmitButton variant="outline">Geri al</SubmitButton></form>
            : multiple && <form action={splitSource}><input type="hidden" name="item_id" value={source.id}/><input type="hidden" name="product_id" value={product.id}/><SubmitButton variant="outline" icon={<GitFork data-icon="inline-start" aria-hidden="true"/>}>Ayır</SubmitButton></form>}
          </div></TableCell>
        </TableRow>)}</TableBody></Table>
        : <Empty><EmptyHeader><EmptyTitle>Bağlı kaynak yok.</EmptyTitle><EmptyDescription>Bu ürünün tedarikçi kaydı kalmadı.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
    </Card>

    {merged && identity}
    </>}

    {tab === "gorseller" && <>
    {!merged && <ProductImagesCard productId={product.id}/>}
    </>}

    {tab === "referanslar" && <>
    {!merged && <ProductReferencesCard productId={product.id}/>}

    {!merged && <ProductSpecsCard productId={product.id}/>}
    </>}

    {tab === "arac-uyumu" && <>
    {!merged && <ProductFitmentsCard productId={product.id}/>}
    </>}

    {tab === "eslestirme" && merge && equivalentSearch && <>
    <Card id="birlestir">
      <CardHeader><CardTitle><h2>Başka ürünle birleştir</h2></CardTitle>
        <CardDescription>Otomatik eşleşmenin kaçırdığı aynı ürünü bulun: parça numarası veya tedarikçi koduyla arayın. Birleşince tüm kaynaklar tek üründe toplanır; Başbuğ&apos;un sattığı ürün kimliğini korur. Farklı marka aynı ürün değildir: yerine kullanılabiliyorsa “Muadil” ile bağlayın.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {edit && <Alert variant="warning"><TriangleAlert aria-hidden="true"/>
          <AlertDescription>Bu ürünün elle düzenlenmiş mağaza bilgileri veya fiyatı{edit.hidden ? " (mağazada gizli)" : ""} var. Birleşince kimliğini koruyan üründe düzenleme yoksa bu düzenlemeler ona taşınır{edit.hidden ? " ve birleşen ürün gizli kalır" : ""}; varsa onunkiler geçerli olur.</AlertDescription></Alert>}
        <form className="flex flex-wrap items-center gap-2" action={`/yonetim/urunler/${product.id}#birlestir`}>
          <input type="hidden" name="tab" value="eslestirme"/>
          {query.eq_q !== undefined && <input type="hidden" name="eq_q" value={equivalentSearch.q}/>}
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
        <CardDescription>Kod veya OEM numarasıyla arayıp muadil ekleyin. Aynı ürün değil, yerine kullanılabilecek ürünler: ortak OEM numarası, SETA gibi tedarikçilerin rakip kodu referansı, “Muadil” marka kararı veya elle bağlantı. Yanlış bağlantıyı “Kaldır” ile çıkarın; yenilemeler yeniden eklemez.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-center gap-2" action={`/yonetim/urunler/${product.id}#muadil`}>
          <input type="hidden" name="tab" value="eslestirme"/>
          {query.merge_q !== undefined && <input type="hidden" name="merge_q" value={merge.q}/>}
          <InputGroup className="w-full sm:w-72"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon>
            <InputGroupInput name="eq_q" aria-label="Muadil eklenecek ürünü ara" defaultValue={query.eq_q} placeholder="Parça no, tedarikçi kodu veya OEM" maxLength={60}/></InputGroup>
          <Button type="submit">Ara</Button>
        </form>
        {query.eq_q !== undefined && (equivalentSearch.q.length < 3
          ? <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>En az 3 harf veya rakam girin.</AlertDescription></Alert>
          : equivalentSearch.targets.length ? <div className="flex flex-col gap-2">
          <h3 className="font-medium">Arama sonuçları ({equivalentSearch.targets.length})</h3>
          <Table controls={false}><caption className="sr-only">Muadil olarak eklenebilecek ürünler</caption>
          <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead>Kaynaklar</TableHead><TableHead>Eşleşme</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{equivalentSearch.targets.map(target => <TableRow key={target.id}>
            <TableCell className="max-w-40 truncate font-medium">{target.brand_label}{target.same_brand && <Badge variant="secondary" className="ml-2">Aynı marka</Badge>}</TableCell>
            <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${target.id}`}>{target.code}</Link></TableCell>
            <TableCell className="max-w-72 truncate" title={target.name ?? ""}>{target.name ?? "—"}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{target.suppliers.length ? target.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>) : <span className="text-muted-foreground">Satışta değil</span>}</div></TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{target.via.map(via => <Badge key={via} variant="outline">{equivalentVia[via]}</Badge>)}</div></TableCell>
            <TableCell><div className="flex flex-wrap items-center justify-end gap-2">
              {target.rejected && <StatusBadge tone="warning">Daha önce kaldırıldı</StatusBadge>}
              {target.equivalent ? <StatusBadge tone="info" icon={Link2}>Muadil</StatusBadge>
                : <form action={linkEquivalent}><input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="other_id" value={target.id}/><input type="hidden" name="eq_q" value={equivalentSearch.q}/>
                  <SubmitButton variant="outline" icon={<Link2 data-icon="inline-start" aria-hidden="true"/>}>{target.rejected ? "Yeniden ekle" : "Muadil ekle"}</SubmitButton></form>}
            </div></TableCell>
          </TableRow>)}</TableBody></Table>
          {equivalentSearch.targets.length >= 30 && <p className="text-muted-foreground">İlk 30 sonuç gösteriliyor, aramayı daraltın.</p>}
        </div>
          : <Empty><EmptyHeader><EmptyTitle>Ürün bulunamadı.</EmptyTitle></EmptyHeader></Empty>)}
        {equivalents.length ? <div className="flex flex-col gap-2">
          <h3 className="font-medium">Bağlı muadiller ({equivalents.length})</h3>
          <Table><caption className="sr-only">Muadil ürünler</caption>
        <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ürün</TableHead><TableHead>Kaynaklar</TableHead><TableHead>Bağlantı nedeni</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>{equivalents.map(item => <TableRow key={item.id}>
          <TableCell className="max-w-32 truncate font-medium">{item.brand_label}</TableCell>
          <TableCell><Link className="font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${item.id}`}>{item.code}</Link></TableCell>
          <TableCell className="max-w-72 truncate" title={item.name ?? ""}>{item.name ?? "—"}</TableCell>
          <TableCell><div className="flex flex-wrap gap-1">{item.suppliers.length ? item.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{supplierNames[supplier] ?? supplier}</Badge>) : <span className="text-muted-foreground">Satışta değil</span>}</div></TableCell>
          <TableCell className="text-muted-foreground">{kinds[item.kind]}{item.kind !== "manual" && <> · <span className="font-mono">{item.via_brand} {item.via_part}</span></>}</TableCell>
          <TableCell><form action={unlinkEquivalent}><input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="other_id" value={item.id}/>{query.eq_q !== undefined && <input type="hidden" name="eq_q" value={equivalentSearch.q}/>}
            <SubmitButton variant="outline" icon={<Unlink data-icon="inline-start" aria-hidden="true"/>}>Kaldır</SubmitButton></form></TableCell>
        </TableRow>)}</TableBody></Table></div>
        : <Empty><EmptyHeader><EmptyMedia variant="icon"><Link2/></EmptyMedia><EmptyTitle>Muadil bulunamadı.</EmptyTitle></EmptyHeader></Empty>}</CardContent>
    </Card>
    </>}

    {tab === "gecmis" && history && <>
    <Card id="gecmis">
      <CardHeader><CardTitle><h2>Değişiklik geçmişi</h2></CardTitle>
        <CardDescription>Sayfa başına 50 kayıt; toplu araç ekleme ve kopyalar tek satırda gösterilir. “Otomatik”, alanın tedarikçi ve zenginleştirme verisinden (fiyatta formülden) geldiğini gösterir.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {history.batch && <div className="flex flex-col items-start gap-2">
          <Alert variant="info"><Info aria-hidden="true"/><AlertDescription>Toplu işlemin {formatNumber(history.batchTypes ?? history.total)} araç tipi gösteriliyor.{history.batchTypes !== null && history.total > history.batchTypes && history.page === history.pages && " Son satır kopyanın özetidir."}</AlertDescription></Alert>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={productTabHref(product.id, "gecmis", { params: { page: backPage }, merged: Boolean(merged) })} scroll={false}/>}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true"/>Tüm geçmişe dön</Button>
        </div>}
        {history.entries.length ? <Table server><caption className="sr-only">Değişiklik geçmişi</caption>
        <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Alan</TableHead><TableHead>Eski değer</TableHead><TableHead>Yeni değer</TableHead><TableHead>Kim</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>{history.entries.map(change => {
          // A bulk fitment change (#816): one line with its count and first types, its rows behind "Ayrıntı".
          const grouped = change.count > 1 || change.summary !== null;
          const summary = grouped ? fitmentBatchSummary(change, vehicleNames) : null;
          return <TableRow key={change.id}>
          <TableCell className="tabular-nums">{formatDateTime(change.changed_at, { year: true })}</TableCell>
          <TableCell>{grouped ? fitmentBatchLabels[change.field] ?? productFitmentChangeLabels[change.field] ?? change.field
            : productImageChangeLabels[change.field] ?? productReferenceChangeLabels[change.field] ?? productSpecChangeLabels[change.field] ?? productFitmentChangeLabels[change.field] ?? (productOverrideFields.includes(change.field as ProductOverrideField) ? productOverrideLabels[change.field as ProductOverrideField] : change.field)}</TableCell>
          {grouped ? <>
            <TableCell className="max-w-72 truncate" title={change.field === "fitment_unadded" ? summary ?? undefined : undefined}>{change.field === "fitment_unadded" ? summary : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="max-w-72 truncate" title={change.field === "fitment_unadded" ? undefined : summary ?? undefined}>{change.field === "fitment_unadded" ? <span className="text-muted-foreground">—</span> : summary}</TableCell>
          </> : <>
            <TableCell className="max-w-72 truncate" title={change.old_value ?? undefined}>{historyValue(change.field, change.old_value)}</TableCell>
            <TableCell className="max-w-72 truncate" title={change.new_value ?? undefined}>{historyValue(change.field, change.new_value)}</TableCell>
          </>}
          <TableCell>{change.reason === "uncarry" ? <span className="text-muted-foreground">Sistem: birleştirme geri alındı</span>
            : <>{change.changed_by ?? <span className="text-muted-foreground">Silinmiş hesap</span>}{change.reason === "carry" && <span className="text-muted-foreground"> · birleştirmeden taşındı</span>}</>}</TableCell>
          <TableCell>{grouped && change.batch_id && <div className="flex flex-col items-end gap-2">
            <Button variant="outline" size="sm" nativeButton={false} aria-label={`${fitmentBatchLabels[change.field] ?? "Toplu işlem"}: ayrıntı`}
              render={<Link href={productTabHref(product.id, "gecmis", { params: { toplu: change.batch_id, geri: history.page > 1 ? String(history.page) : undefined }, merged: Boolean(merged) })} scroll={false}/>}>Ayrıntı</Button>
            {change.undoable > 0 && !merged && <ProductFitmentBatchUndo productId={product.id} batchId={change.batch_id} count={change.undoable}/>}
          </div>}</TableCell>
        </TableRow>;
        })}</TableBody></Table>
        : history.batch ? <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Bu toplu işlemin kaydı bulunamadı.</EmptyTitle>
          <EmptyDescription>Bağlantı başka bir ürüne ait olabilir; tüm geçmişe dönün.</EmptyDescription></EmptyHeader></Empty>
        : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz elle değişiklik yok.</EmptyTitle>
          <EmptyDescription>Mağaza bilgileri tamamen otomatik kaynaklardan geliyor.</EmptyDescription></EmptyHeader></Empty>}</CardContent>
      {history.pages > 1 && <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-muted-foreground tabular-nums">{formatNumber(history.total)} kayıt</span>
        <Pagination aria-label="Geçmiş sayfaları" className="mx-0 w-auto"><PaginationContent>
          <PaginationItem>{history.page > 1
            ? <Button variant="outline" size="icon" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={productTabHref(product.id, "gecmis", { params: { page: String(history.page - 1), toplu: history.batch ?? undefined, geri: backPage }, merged: Boolean(merged) })} scroll={false}/>}><ChevronLeft/></Button>
            : <Button variant="outline" size="icon" aria-label="Önceki sayfa" disabled><ChevronLeft/></Button>}</PaginationItem>
          <PaginationItem><span className="px-2 text-muted-foreground tabular-nums" aria-label={`Sayfa ${history.page} / ${history.pages}`}>{formatNumber(history.page)} / {formatNumber(history.pages)}</span></PaginationItem>
          <PaginationItem>{history.page < history.pages
            ? <Button variant="outline" size="icon" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={productTabHref(product.id, "gecmis", { params: { page: String(history.page + 1), toplu: history.batch ?? undefined, geri: backPage }, merged: Boolean(merged) })} scroll={false}/>}><ChevronRight/></Button>
            : <Button variant="outline" size="icon" aria-label="Sonraki sayfa" disabled><ChevronRight/></Button>}</PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>}
    </Card>
    </>}

  </div>;
}
