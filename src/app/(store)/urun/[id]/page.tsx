import { Fragment, cache, type CSSProperties } from "react";
import type { Metadata } from "next";
import { defaultSocialImage, siteOpenGraph, siteUrl } from "@/lib/site";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Truck, Info, ShieldCheck, RotateCcw, ClipboardCheck, PackageCheck, CircleAlert, Headphones } from "lucide-react";
import { getDecidedEquivalents, getSetaEquivalents, getStorefrontProduct, getStoreProduct, money, servicePrice, categories } from "@/modules/store/catalog";
import { currentAccount } from "@/modules/auth/session";
import { PurchaseForm } from "@/components/purchase-form";
import { RestockRequestForm } from "@/components/restock-request-form";
import { PartArt } from "@/components/part-art";
import { LoginButton } from "@/components/auth/login-button";
import { getProductEnrichment } from "@/modules/store/product-enrichment";
import { readableProductName } from "@/modules/store/product-name";
import { productSeoDescription, productSeoTitle } from "@/modules/seo/product-meta";
import { getItemOverride } from "@/modules/store/product-overrides";
import { getItemReferences } from "@/modules/store/product-references";
import { applyReferenceOverrides, gtinProperty } from "@/modules/store/product-reference-display";
import { getItemSpecs } from "@/modules/store/product-specs";
import { applySpecOverrides } from "@/modules/store/product-spec-display";
import { productDescription, productMeta, productTitle, shownPartNumber } from "@/modules/store/product-override-display";
import {getStoreCategories} from "@/modules/store/categories";
import {categoryPath} from "@/modules/store/category-tree";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import { ManufacturerBadge } from "@/components/manufacturer-badge";
import { ProductGallery } from "@/components/product-gallery";
import { getItemImages } from "@/modules/store/product-images";
import { galleryImages, socialImage } from "@/modules/store/product-image-display";
import { GarageButton } from "@/components/garage/garage-button";
import { currentVehicle } from "@/modules/store/garage";
import { fitmentLevel } from "@/modules/store/fitment-level";
import { fitmentVehicle } from "@/modules/store/fitment-level.server";
import { describeYears, getDescriptionFitments } from "@/modules/store/description-fitment.server";
import { ProductFitment } from "@/components/product-fitment";
import { getReferenceLinks } from "@/modules/store/reference-links";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { JsonLd } from "@/components/json-ld";
import { TrackViewItem } from "@/components/privacy/track-events";
import { catalogItem } from "@/modules/analytics/events";
import { breadcrumbJsonLd, productJsonLd, productTrail } from "@/modules/seo/structured-data";
import { campaignEndText, listPrice, saleUntil } from "@/modules/store/best-offer";
import { hasMinimumContent, productContent, productIndexable } from "@/modules/seo/indexing";

const benefits = [
  { icon: ShieldCheck, size: 23, title: "Güvenli alışveriş", text: <>Fiyat ve sipariş bilgilerini hesabından takip et.</> },
  { icon: Truck, size: 25, title: "Tek noktadan tedarik", text: <>Parçaların Getirbakim operasyonunda bir araya gelir.</> },
  { icon: RotateCcw, size: 23, title: "İade ve değişim", text: <Link className="hover:text-[#0065c3]" href="/bilgi/teslimat">İade koşullarını ve sürecini incele.</Link> },
  { icon: ClipboardCheck, size: 23, title: "Araç uyumluluğu", text: <>OEM kodunu, motor ve model bilgilerini karşılaştır.</> },
];

// Metadata and the page read the same enrichment once per request. The enrichment is looked up by the supplier's code
// and brand; display_code / display_brand (an admin's part number and store brand, #602) are only printed.
const productEnrichment = cache((id: string, code: string, brand: string) => getProductEnrichment({ id, code, brand }));
// The vehicle models of the supplier's description: an index signal of the metadata (#641) and a section of the page.
const descriptionFitments = cache(getDescriptionFitments);
// The vehicle models of the search metadata: the enrichment's (`confirmed`, they may name the title's "uyumlu" vehicle) and,
// without them, the models read from the supplier's description, which name no engine and only feed the description text.
async function vehicleModels(enrichment: { vehicleModels: string[]; vehicles: { model: string }[] } | null, productId: string) {
  const models = enrichment?.vehicleModels.length ? enrichment.vehicleModels : enrichment?.vehicles.map(vehicle => vehicle.model) ?? [];
  if (models.length) return { confirmed: [...new Set(models)], all: [...new Set(models)] };
  return { confirmed: [], all: (await descriptionFitments(productId)).map(row => `${row.brand} ${row.model}`) };
}
// The description models are read here only when the enrichment's signals fall short; the metadata and the page share the cached read.
async function indexable(product: Parameters<typeof productIndexable>[0] & { id: string; oem: string }, enrichment: unknown) {
  const content = productContent({ enrichment, descriptionModels: [], oem: product.oem });
  if (product.source === "store" || hasMinimumContent(content)) return productIndexable(product, content);
  return productIndexable(product, productContent({ enrichment, descriptionModels: await descriptionFitments(product.id), oem: product.oem }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await getStorefrontProduct(id);
  if (!product) return { title: "Ürün bulunamadı", robots: { index: false } };
  // An admin's SEO title and description (#575) replace the automatic ones, which follow the page's title and description.
  const [override, enrichment, uploads] = await Promise.all([getItemOverride(product.id), productEnrichment(product.id, product.code, product.brand), getItemImages(product.id)]);
  const description = productDescription(override, enrichment?.description, product.description);
  const name = productTitle(override, enrichment?.displayName, readableProductName(product.name));
  const vehicles = await vehicleModels(enrichment, product.id);
  const hint = `${product.name} ${product.description}`;
  const meta = productMeta(override, {
    title: productSeoTitle({ brand: product.display_brand, name, partNumber: product.display_code, vehicles: vehicles.confirmed, hint }),
    description: productSeoDescription({ brand: product.display_brand, name, partNumber: product.display_code, oem: product.oem, vehicles: vehicles.all, text: description, hint }),
  });
  const images = galleryImages(uploads.images,
    enrichment?.imagePath ? { src: enrichment.imagePath, width: enrichment.imageWidth, height: enrichment.imageHeight } : null, uploads.hideAutomatic);
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/urun/${id}` },
    openGraph: { ...siteOpenGraph, title: meta.title, description: meta.description, url: `/urun/${id}`,
      images: [socialImage(images, meta.title, defaultSocialImage)] },
    robots: await indexable(product, enrichment) ? undefined : { index: false, follow: true },
  };
}

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { product, primaryId } = await getStoreProduct(id);
  // A supplier offer of a product several suppliers sell is shown on that product's page; a row the store does not
  // list (a dropped duplicate, a code sold from another list) on the page that shows the product now (#475).
  if (primaryId) redirect(`/urun/${primaryId}`);
  if (!product) notFound();
  const [enrichment, override, uploads, referenceOverrides, specOverrides] = await Promise.all([productEnrichment(product.id, product.code, product.brand), getItemOverride(product.id),
    getItemImages(product.id), getItemReferences(product.id), getItemSpecs(product.id)]);
  // The enrichment's OEM / cross-reference numbers with the admin's hidden ones left out and added ones in (#582).
  const refs = applyReferenceOverrides({ oemNumbers: enrichment?.oemNumbers ?? {}, crossReferences: enrichment?.crossReferences ?? {} }, referenceOverrides);
  const gtin = refs.eans[0] && gtinProperty(refs.eans[0]);
  // The admin's uploads (#581) come first; the enrichment image follows unless the admin hid it.
  const images = galleryImages(uploads.images,
    enrichment?.imagePath ? { src: enrichment.imagePath, width: enrichment.imageWidth, height: enrichment.imageHeight } : null, uploads.hideAutomatic);
  const logos = await getManufacturerLogos([product.display_brand]);
  const account = await currentAccount();
  const isB2B = Boolean(account?.approved && account.role === "service");
  const storeCategories=await getStoreCategories();
  // An admin's category (#575) replaces the enrichment's.
  const leafId=override?.category_id ?? enrichment?.categories[0]?.id;
  const productCategoryPath=leafId?categoryPath(storeCategories,leafId):[];
  const category = categories.find(c => c.slug === product.category);
  const price = product.price_kurus === null ? null : money(servicePrice(product.price_kurus!, isB2B ? account!.discount_percent : 0));
  // A running campaign (#580): the regular price struck through, with the same service discount as the price.
  const regular = listPrice(product), campaignEnd = saleUntil(product);
  const previousPrice = regular === null || product.price_kurus === null ? null : money(servicePrice(regular, isB2B ? account!.discount_percent : 0));

  const ownPartNumber = product.code.startsWith(`${product.brand} `) ? product.code.slice(product.brand.length + 1) : product.code;
  // Dinamik codes carry the brand ("BOSCH 0986424285"); the brand is printed next to the number already.
  // Only an exact match may print the source's spelling; OEM and cross-reference donors are other manufacturers' parts.
  // An admin's part number (#602) wins as entered.
  const displayPartNumber = shownPartNumber(product, enrichment?.matchBasis.type === "exact_part" ? enrichment.partNumber || ownPartNumber : ownPartNumber);
  const brand = product.display_brand;
  const title = productTitle(override, enrichment?.displayName, readableProductName(product.name));
  const description = productDescription(override, enrichment?.description, product.description);
  // The markup is the same for every visitor: it reads the product's own price, never `price`, an account or the garage.
  const trail = productTrail({ categories: productCategoryPath.length ? productCategoryPath : category ? [category] : [], title: `${title} ${brand} ${displayPartNumber}`, productId: product.id });
  const structuredProduct = productJsonLd({ id: product.id, supplier: product.supplier, name: title, description: description || undefined, sku: product.code, mpn: displayPartNumber, brand,
    images: images.map(image => image.src), gtin: gtin ? { property: gtin, value: refs.eans[0] } : null,
    category: productCategoryPath.map(node => node.name).join(" > ") || category?.name,
    priceKurus: product.price_kurus, available: product.available, stockLabel: product.stock_label, unavailable: product.unavailable,
    pricingSnapshot: product.pricing_snapshot,
    vehicleModels: enrichment?.vehicles.length ? enrichment.vehicles.map(vehicle => vehicle.model) : enrichment?.vehicleModels ?? [] }, siteUrl);
  const vehicle = await currentVehicle();
  // Without engine-level TecDoc data, the models named in the supplier's description (#392) can only make a garage
  // vehicle "likely": they never name an engine type.
  const descriptionModels = enrichment?.vehicles.length || enrichment?.vehicleModels.length ? [] : await descriptionFitments(product.id);
  const fitment = vehicle && fitmentLevel(await fitmentVehicle(vehicle),
    enrichment?.vehicles.length ? enrichment.vehicles : descriptionModels.map(row => ({ vehicleTypeId: null, modelId: row.modelId })));
  // The enrichment's specifications with the admin's edited, hidden and added keys (#603).
  const specifications: [string, string][] = [...applySpecOverrides(enrichment?.specifications || [], specOverrides), ["Üretici", brand], ["Üretici parça numarası", displayPartNumber]];
  if (product.oem) specifications.unshift(["OEM numarası", product.oem]);
  if (refs.eans.length) specifications.push(["Barkod (EAN)", refs.eans.join(", ")]);
  const hasFitment = Boolean(enrichment && (enrichment.vehicles.length || enrichment.vehicleModels.length)) || descriptionModels.length > 0;
  const fitmentSummary = enrichment?.vehicleModels.length ? enrichment.vehicleModels : descriptionModels.map(row => `${row.brand} ${row.model}`);
  const referenceNumbers: Record<string, string[]> = {};
  for (const [brand, codes] of [...Object.entries(refs.crossReferences), ...Object.entries(refs.oemNumbers)]) {
    referenceNumbers[brand] = [...new Set([...(referenceNumbers[brand] || []), ...codes])];
  }
  const references = Object.entries(referenceNumbers).sort(([a], [b]) => a.localeCompare(b));
  const referenceHref = await getReferenceLinks(product.id, [
    ...Object.entries(refs.crossReferences).map(([brand, codes]) => ({ brand, codes, kind: "cross" as const })),
    ...Object.entries(refs.oemNumbers).map(([brand, codes]) => ({ brand, codes, kind: "oem" as const })),
  ]);
  const [seta, decided] = await Promise.all([product.supplier === "seta" ? [] : getSetaEquivalents(product.id), getDecidedEquivalents(product.id)]);
  const referenceRows: [string, { code: string; href?: string | null }[]][] = references.map(([brand, codes]) => [brand, codes.map(code => ({ code, href: referenceHref(brand, code) }))]);
  // Equivalents listed in the store link to their pages, first in their brand's row; a code printed by the
  // enrichment's references as well is shown once.
  const linkEquivalents = (brand: string, items: { id: string | null; code: string }[]) => {
    // Dinamik codes carry the brand's first word ("WAGENBURG 15036003"), printed in the row's label already.
    const prefix = `${brand.split(" ")[0]} `;
    const linked = items.map(item => ({ code: brand !== "SETA" && item.code.startsWith(prefix) ? item.code.slice(prefix.length) : item.code, href: item.id && `/urun/${item.id}` }));
    const existing = referenceRows.findIndex(([name]) => name.toLocaleUpperCase("tr-TR") === brand.toLocaleUpperCase("tr-TR"));
    if (existing >= 0) {
      const [name, codes] = referenceRows[existing];
      referenceRows[existing] = [name, [...linked, ...codes.filter(({ code }) => !linked.some(item => item.code === code))]];
    } else referenceRows.push([brand, linked]);
  };
  // SETA equivalents under the part number the store shows for them (#602).
  if (seta.length > 0) linkEquivalents("SETA", seta.map(item => ({ id: item.id, code: item.display_code })));
  const decidedBrands = new Map<string, typeof decided>();
  for (const item of decided.filter(item => !seta.some(row => row.id === item.id))) decidedBrands.set(item.brand, [...(decidedBrands.get(item.brand) || []), item]);
  for (const [brand, items] of decidedBrands) linkEquivalents(brand, items);
  referenceRows.sort(([a], [b]) => a.localeCompare(b));
  const crumbLink = "transition-colors hover:text-[#2d78c7]";
  const crumbSeparator = <BreadcrumbSeparator className="[&>svg]:size-[13px]"><ChevronRight/></BreadcrumbSeparator>;
  const sectionTitle = "mb-7 text-[26px] leading-[34px] font-semibold tracking-[-.6px] max-[750px]:mb-5 max-[750px]:text-[23px] max-[750px]:leading-[30px]";
  const shell = "mx-auto w-full max-w-[1440px] px-3.5 min-[1450px]:px-8 max-[750px]:px-4";
  const garageNote = "flex items-start gap-2 text-[13px] leading-5 [&>svg]:mt-0.5 [&>svg]:shrink-0";
  return <div className="text-sm leading-5 text-foreground"><section className={shell}>
    <JsonLd data={structuredProduct}/>{product.price_kurus !== null && !product.unavailable && <TrackViewItem item={catalogItem({ id: product.id, name: `${title} ${brand} ${displayPartNumber}`, brand, category: productCategoryPath.map(node => node.name).join(" > ") || category?.name }, servicePrice(product.price_kurus, isB2B ? account!.discount_percent : 0))}/>}{product.supplier !== "demo" && <JsonLd data={breadcrumbJsonLd(trail, siteUrl)}/>}
    <Breadcrumb aria-label="Sayfa yolu" className="py-3">
      <BreadcrumbList className="gap-[7px] text-[13px] leading-5 text-[#53677d] max-[750px]:text-[11px]">
        {trail.map((crumb, index) => index === trail.length - 1
          ? <BreadcrumbItem key={crumb.path}><BreadcrumbPage className="text-inherit">{crumb.name}</BreadcrumbPage></BreadcrumbItem>
          : <Fragment key={crumb.path}><BreadcrumbItem><BreadcrumbLink className={crumbLink} render={<Link href={crumb.path}/>}>{crumb.name}</BreadcrumbLink></BreadcrumbItem>{crumbSeparator}</Fragment>)}
      </BreadcrumbList>
    </Breadcrumb>
    <div className="grid grid-cols-2 items-start gap-4 max-[750px]:grid-cols-1 max-[750px]:gap-3">
      <div className="relative min-w-0 max-[750px]:pt-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-1 flex min-h-9 items-center gap-5"><ManufacturerBadge brand={brand} logo={logos.get(brand)} className="inline-flex items-center rounded-[20px] border border-[#e12d32] bg-white px-3.5 py-1 font-medium"/>{product.supplier === "demo" && <span className="text-xs text-[#65758a]">Sentetik örnek ürün</span>}</div>
        {images.length ? <ProductGallery key={product.id} images={images} alt={`${brand} ${displayPartNumber} ${title}`}/> : <div className="flex h-[540px] items-center justify-center p-12 max-[1000px]:h-[440px] max-[750px]:h-[340px] max-[750px]:p-3"><PartArt kind={category?.art} className="h-[400px] w-full"/></div>}
      </div>
      <div>
        <h1 className="mb-2 text-[36px] leading-[42px] font-semibold tracking-[-1px] wrap-anywhere max-[1000px]:text-[30px] max-[1000px]:leading-9 max-[750px]:text-[27px] max-[750px]:leading-[34px] max-[750px]:tracking-[-.7px]">{title} {brand} {displayPartNumber}</h1>
        {hasFitment && <p className="mb-3.5 text-[13px] leading-[21px] text-[#53677d]">Uyumlu araçlar: {fitmentSummary.slice(0, 3).join(", ")} <a className="font-medium whitespace-nowrap text-[#0069c7] hover:underline" href="#uyumlu-araclar">Tümünü göster</a></p>}
        <p className="my-3 text-[13px] text-[#53677d]">Ürün kodu: {product.display_code}</p>
        {product.unavailable ? <>
          <div className="py-[15px]"><h2 className="text-2xl leading-[34px] font-semibold">Şu an tedarik edilemiyor</h2><p className="text-[#53677d]">Tedarikçilerimiz bu ürünü şu an sunmuyor; yeniden satışa sunulduğunda sipariş verebilirsin.</p></div>
          <PurchaseForm productId={product.id} name={product.display_code} available={false} maxQuantity={1} variant="product"/>
          <RestockRequestForm productId={product.id} email={account?.email}/>
        </> : product.price_kurus === null ? <div className="py-[15px]"><h2 className="text-2xl leading-[34px] font-semibold">Fiyat bilgisi güncelleniyor</h2><p>Güncel fiyat alındığında siparişe açılacak.</p></div> : <>
          {isB2B && <span className="text-xs text-[#53677d]">Servisine özel B2B fiyatı</span>}
          <p className="mt-2.5 mb-0.5 text-[32px] leading-10 font-semibold tracking-[-.7px] text-[#ed3821]">{price}</p>
          {previousPrice && <p className="mb-1 text-[15px] text-muted-foreground"><span className="sr-only">Önceki fiyat: </span><s>{previousPrice}</s>
            {campaignEnd && <span className="block text-[13px]">Kampanya {campaignEndText(campaignEnd)} tarihine kadar</span>}</p>}
          <p className="mb-[18px] flex items-center gap-2 text-[13px] text-[#53677d]">KDV dahil <span className="h-3.5 border-l border-[#dbe0e6]"/> <Link className="hover:text-[#0065c3]" href="/bilgi/teslimat">Kargo ücreti hariç</Link></p>
          <PurchaseForm productId={product.offer_id ?? product.id} name={product.display_code} available={product.available} maxQuantity={product.max_quantity} variant="product"/>
        </>}
        <div className="flex min-h-[54px] items-center gap-4 rounded-[5px] border border-[#ffb380] bg-[#fffaee] px-4 py-3"><CircleAlert size={20} className="shrink-0 text-[#fb8c00]"/><GarageButton vehicle={vehicle} variant="product"/></div>
        {fitment === "guaranteed" && <p className={cn(garageNote, "text-[#26734d]")}><ClipboardCheck size={17}/>Garajındaki {vehicle!.make} {vehicle!.model}, bu ürünün uyumluluk listesinde yer alıyor.</p>}
        {fitment === "likely" && (descriptionModels.length
          ? <p className={cn(garageNote, "text-[#8a5a00]")}><Info size={17}/>Garajındaki {vehicle!.make} {vehicle!.model} modeli ürün açıklamasında geçiyor; motor tipi doğrulanmadı, siparişten önce OEM kodunu kontrol et.</p>
          : <p className={cn(garageNote, "text-[#8a5a00]")}><Info size={17}/>Garajındaki {vehicle!.make} {vehicle!.model} modeli listede; motor tipini <a className="underline" href="#uyumlu-araclar">uyumlu araçlar</a> tablosundan doğrula.</p>)}
        {vehicle && fitment === "unknown" && <p className={cn(garageNote, "text-[#8a5a00]")}><Info size={17}/>Garajındaki {vehicle.make} {vehicle.model} için bu ürünün uyumu doğrulanamadı; siparişten önce OEM kodunu kontrol et.</p>}
        {fitment === "mismatch" && <p className={cn(garageNote, "font-semibold text-[#b3261e]")} role="alert"><CircleAlert size={17}/>Garajındaki {vehicle!.make} {vehicle!.model}{vehicle!.engine ? ` ${vehicle!.engine}` : ""} bu ürünün uyumluluk listesinde yok. Siparişten önce OEM kodunu kontrol et.</p>}
        {!product.unavailable && <p className={cn("my-5 flex items-center gap-2 text-[13px] max-[750px]:my-[18px]", !product.available && "text-[#66778a]")}><PackageCheck size={17}/>{product.stock_label}</p>}
        <Link className="flex items-center gap-4 border-y border-[#dbe0e6] py-[18px]" href="/bilgi/teslimat"><Truck size={32} className="shrink-0"/><span><strong className="flex items-center gap-1.5 text-base font-medium">Teslimat bilgileri <Info size={14} className="text-[#2e78c7]"/></strong><small className="mt-1 block text-[13px] text-[#53677d]">{product.source === "supplier" ? "Stok ve sevkiyat süresi sipariş sonrası teyit edilir." : "Parçaların tek noktadan hazırlanır ve gönderilir."}</small></span><ChevronRight size={18} className="ml-auto shrink-0 text-[#53677d]"/></Link>
        <dl className="mt-[18px] mb-1.5">{specifications.slice(0, 4).map(([label, value]) => <div key={label} className="my-2 flex gap-[5px]"><dt className="text-[#53677d]">{label}:</dt><dd className="font-medium">{value}</dd></div>)}</dl>
        <a className="mb-5 inline-block font-medium text-[#0065c3] hover:underline" href="#product-specifications">Tüm özellikleri göster</a>
        {!isB2B && <div className="flex flex-wrap items-center gap-3.5 border-t border-[#e0e5eb] pt-5 pb-1 text-[#0065c3]"><LoginButton className="min-h-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-[#53677d] hover:text-[#0065c3]">B2B hesabınla özel fiyatlarını gör →</LoginButton></div>}
      </div>
    </div>
    <div className="mt-8 mb-10 grid grid-cols-2 gap-[15px] max-[750px]:my-7 max-[750px]:grid-cols-1 max-[750px]:gap-2.5">
      {benefits.map(({ icon: Icon, size, title, text }) => <div key={title} className="flex min-h-[86px] items-start gap-3.5 rounded-[5px] border border-[#dfe4ea] p-5 max-[750px]:min-h-[76px] max-[750px]:p-4"><Icon size={size} strokeWidth={1.25} className="shrink-0"/><span><strong className="block font-medium">{title}</strong><small className="mt-1 block text-[13px] leading-5 text-[#465a70]">{text}</small></span></div>)}
    </div>
  </section>
  <div className="border-t border-[#dce2e9] bg-[#f7f8fa] pt-[50px] pb-[60px] max-[750px]:pt-7 max-[750px]:pb-10"><div className={cn(shell, "grid grid-cols-[minmax(0,1fr)_280px] items-start gap-12 max-[1000px]:grid-cols-[minmax(0,1fr)_230px] max-[1000px]:gap-6 max-[750px]:flex max-[750px]:flex-col max-[750px]:gap-6")}>
    <div className="min-w-0 max-[750px]:w-full">
      <section className="scroll-mt-[110px]" id="product-specifications" aria-labelledby="specifications-title">
        <h2 id="specifications-title" className={sectionTitle}>{title} {brand} {displayPartNumber} teknik bilgileri</h2>
        <dl className="m-0 grid grid-flow-col grid-cols-2 grid-rows-[repeat(var(--spec-rows,5),auto)] gap-x-14 max-[1000px]:gap-x-6 max-[750px]:block" style={{ "--spec-rows": Math.ceil(specifications.length / 2) } as CSSProperties}>{specifications.map(([label, value]) => <div key={label} className="grid grid-cols-[45%_minmax(0,1fr)] items-start gap-3 border-b border-[#e0e5eb] py-[11px] max-[1000px]:grid-cols-1 max-[1000px]:gap-1 max-[750px]:grid-cols-[45%_minmax(0,1fr)] max-[750px]:gap-3"><dt className="text-[#53677d]">{label}:</dt><dd className="font-medium wrap-anywhere">{value}</dd></div>)}</dl>
        {description && <p className="mt-6 leading-6 whitespace-pre-line text-[#53677d]">{description}</p>}
      </section>
      {enrichment && (enrichment.vehicles.length > 0 ? <ProductFitment vehicles={enrichment.vehicles}/> : enrichment.vehicleModels.length > 0 && <section className="mt-[42px] scroll-mt-[110px]" id="uyumlu-araclar"><h2 className={sectionTitle}>Uyumlu araç modelleri</h2><div className="flex flex-wrap gap-3">{enrichment.vehicleModels.map(model => <span key={model} className="rounded-[5px] border border-[#dce2e9] bg-white px-[18px] py-3">{model}</span>)}</div><p>Motor ve üretim yılı uyumluluğunu OEM numarasıyla kontrol et.</p></section>)}
      {descriptionModels.length > 0 && <section className="mt-[42px] scroll-mt-[110px]" id="uyumlu-araclar"><h2 className={sectionTitle}>Uyumlu araç modelleri</h2><div className="flex flex-wrap gap-3">{descriptionModels.map(row => <span key={row.modelId} className="rounded-[5px] border border-[#dce2e9] bg-white px-[18px] py-3">{row.brand} {row.model}{describeYears(row) && <span className="text-[#53677d]"> · {describeYears(row)}</span>}</span>)}</div><p className="mt-3 text-[#53677d]">Bu liste tedarikçinin ürün açıklamasından çıkarıldı; motor tipi doğrulanmadı. Siparişten önce OEM numarasıyla kontrol et.</p></section>}
      {referenceRows.length > 0 && <section className="mt-[42px] scroll-mt-[110px]" id="oem-numaralari"><h2 className={sectionTitle}>{brand} {displayPartNumber} OEM ve muadil numaraları</h2><dl className="m-0 max-h-[420px] overflow-y-auto overscroll-contain rounded-lg border border-[#dce2e9] bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0065c3] max-[750px]:max-h-[360px]" tabIndex={0} aria-label="OEM ve muadil numaraları">{referenceRows.map(([brand, codes]) => <div key={brand} className="grid grid-cols-[180px_minmax(0,1fr)] gap-6 border-b border-[#e0e5eb] px-5 py-[15px] last:border-0 max-[750px]:grid-cols-[100px_minmax(0,1fr)] max-[750px]:gap-4 max-[750px]:p-3.5 max-[750px]:text-[13px]"><dt className="text-[#53677d]">{brand}</dt><dd className="m-0 flex flex-wrap gap-x-[22px] gap-y-2 font-medium wrap-anywhere">{codes.map(({ code, href }) => href ? <Link key={code} className="text-[#0065c3] hover:underline focus-visible:underline" href={href}>{code}</Link> : <span key={code}>{code}</span>)}</dd></div>)}</dl></section>}
      <section className="mt-[42px] flex scroll-mt-[110px] gap-5 border-t border-[#dce2e9] pt-9" id="urun-yardim"><Headphones size={30} className="shrink-0"/><div><h2 className={cn(sectionTitle, "mb-3 max-[750px]:mb-3")}>Bu ürün hakkında soruların mı var?</h2><p className="text-[#53677d]">{title} için ürün, uyumluluk ve sipariş bilgileri konusunda yardım al.</p><Link className="inline-flex items-center gap-1.5 font-medium text-[#0065c3] hover:underline" href="/bilgi/yardim">Yardım merkezine git <ChevronRight size={15}/></Link></div></section>
    </div>
    <nav className="sticky top-[110px] overflow-hidden rounded-[11px] border border-[#dce2e9] bg-white py-2 max-[750px]:static max-[750px]:order-first max-[750px]:flex max-[750px]:w-full max-[750px]:flex-wrap max-[750px]:rounded-md max-[750px]:p-1.5" aria-label="Ürün bilgileri">{[
      ["#product-specifications", "Ürün detayları", true],
      ["#uyumlu-araclar", "Uyumlu araçlar", hasFitment],
      ["#oem-numaralari", "OEM ve muadil numaraları", referenceRows.length > 0],
      ["#urun-yardim", "Bu ürün hakkında sorular", true],
    ].filter(([, , shown]) => shown).map(([href, label]) => <a key={String(href)} href={String(href)} className="block px-5 py-2 text-sm leading-[18px] font-medium first:bg-[#f7f8fa] hover:bg-[#f7f8fa] max-[750px]:px-2.5 max-[750px]:text-xs">{label}</a>)}</nav>
  </div></div></div>;
}
