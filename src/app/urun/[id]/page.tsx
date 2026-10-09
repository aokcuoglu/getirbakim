import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Truck, Info, ShieldCheck, RotateCcw, ClipboardCheck, PackageCheck, CircleAlert, Headphones } from "lucide-react";
import { getProduct, money, servicePrice, categories } from "@/modules/store/catalog";
import { currentAccount } from "@/modules/auth/session";
import { PurchaseForm } from "@/components/purchase-form";
import { PartArt } from "@/components/part-art";
import { LoginButton } from "@/components/auth/login-button";
import { getProductEnrichment } from "@/modules/store/product-enrichment";
import {getStoreCategories} from "@/modules/store/categories";
import {categoryPath} from "@/modules/store/category-tree";
import { getManufacturerLogos } from "@/modules/store/manufacturer-logos";
import { ManufacturerBadge } from "@/components/manufacturer-badge";
import { ProductGallery } from "@/components/product-gallery";
import { GarageButton } from "@/components/garage/garage-button";
import { currentVehicle } from "@/modules/store/garage";
import "@/styles/product-detail.css";
import { ProductFitment } from "@/components/product-fitment";
import { getReferenceLinks } from "@/modules/store/reference-links";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return { title: "Ürün bulunamadı | Getirbakim", robots: { index: false } };
  return {
    title: `${product.brand} ${product.name} — ${product.code} | Getirbakim`,
    description: `${product.brand} ${product.code}. ${product.description || "Ürün özelliklerini incele; uyumluluğu OEM kodu ve araç bilgileriyle kontrol et."}`.slice(0, 180),
    alternates: { canonical: `/urun/${id}` },
    robots: product.supplier === "demo" || product.source === "supplier" ? { index: false, follow: true } : undefined,
  };
}

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();
  const enrichment = await getProductEnrichment(product);
  const logos = await getManufacturerLogos([product.brand]);
  const account = await currentAccount();
  const isB2B = Boolean(account?.approved && account.role === "service");
  const storeCategories=await getStoreCategories();
  const leaf=enrichment?.categories[0];
  const productCategoryPath=leaf?categoryPath(storeCategories,leaf.id):[];
  const category = categories.find(c => c.slug === product.category);
  const price = product.price_kurus === null ? null : money(servicePrice(product.price_kurus!, isB2B ? account!.discount_percent : 0));

  // No Offer until payment, final tax/shipping and availability are verified.
  const structuredProduct = { "@context": "https://schema.org", "@type": "Product", name: product.name,
    sku: product.code, brand: { "@type": "Brand", name: product.brand },
    description: enrichment?.description || product.description || undefined, image: enrichment?.imagePath ? `${siteUrl}${enrichment.imagePath}` : undefined, url: `${siteUrl}/urun/${product.id}` };
  const vehicle = await currentVehicle();
  const title = enrichment?.displayName || product.name;
  const ownPartNumber = product.code.startsWith(`${product.brand} `) ? product.code.slice(product.brand.length + 1) : product.code;
  const displayPartNumber = enrichment?.matchBasis.type === "oem_reference" ? ownPartNumber : enrichment?.partNumber || product.code;
  const specifications: [string, string][] = [...(enrichment?.specifications || []), ["Üretici", product.brand], ["Üretici parça numarası", displayPartNumber]];
  if (product.oem) specifications.unshift(["OEM numarası", product.oem]);
  const hasFitment = Boolean(enrichment && (enrichment.vehicles.length || enrichment.vehicleModels.length));
  const referenceNumbers: Record<string, string[]> = {};
  for (const [brand, codes] of [...Object.entries(enrichment?.crossReferences || {}), ...Object.entries(enrichment?.oemNumbers || {})]) {
    referenceNumbers[brand] = [...new Set([...(referenceNumbers[brand] || []), ...codes])];
  }
  const references = Object.entries(referenceNumbers).sort(([a], [b]) => a.localeCompare(b));
  const referenceHref = await getReferenceLinks(product.id, [
    ...Object.entries(enrichment?.crossReferences || {}).map(([brand, codes]) => ({ brand, codes, kind: "cross" as const })),
    ...Object.entries(enrichment?.oemNumbers || {}).map(([brand, codes]) => ({ brand, codes, kind: "oem" as const })),
  ]);
  return <div className="pdp-page"><section className="shell pdp-overview">
    {product.supplier !== "demo" && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredProduct).replace(/</g, "\\u003c") }}/>}
    <nav className="pdp-breadcrumbs" aria-label="Sayfa yolu"><Link href="/">Ana sayfa</Link><ChevronRight size={13}/><Link href="/katalog">Katalog</Link><ChevronRight size={13}/>{productCategoryPath.length?productCategoryPath.map(node=><span key={node.id}><Link href={`/katalog?category=${node.slug}`}>{node.name}</Link><ChevronRight size={13}/></span>):category&&<><Link href={`/katalog?category=${category.slug}`}>{category.name}</Link><ChevronRight size={13}/></>}<span aria-current="page">{title} {product.brand} {displayPartNumber}</span></nav>
    <div className="pdp-hero">
      <div className="pdp-gallery">
        <div className="pdp-brand-row"><ManufacturerBadge brand={product.brand} logo={logos.get(product.brand)} className="pdp-brand-badge"/>{product.supplier === "demo" && <span className="pdp-demo">Sentetik örnek ürün</span>}</div>
        {enrichment?.imagePath ? <ProductGallery src={enrichment.imagePath} width={enrichment.imageWidth} height={enrichment.imageHeight} alt={`${product.brand} ${displayPartNumber} ${title}`}/> : <div className="pdp-placeholder"><PartArt kind={category?.art}/></div>}
      </div>
      <div className="pdp-summary">
        <h1>{title} {product.brand} {displayPartNumber}</h1>
        {hasFitment && <p className="pdp-compatible">Uyumlu araçlar: {enrichment!.vehicleModels.slice(0, 3).join(", ")} <a href="#uyumlu-araclar">Tümünü göster</a></p>}
        <p className="pdp-code">Ürün kodu: {product.code}</p>
        {product.price_kurus === null ? <div className="pdp-price-unavailable"><h2>Fiyat bilgisi güncelleniyor</h2><p>Güncel fiyat alındığında siparişe açılacak.</p></div> : <>
          {isB2B && <span className="pdp-price-label">Servisine özel B2B fiyatı</span>}
          <p className="pdp-price">{price}</p>
          <p className="pdp-tax">KDV dahil <span/> <Link href="/bilgi/teslimat">Kargo ücreti hariç</Link></p>
          <PurchaseForm productId={product.id} name={product.code} available={product.available} maxQuantity={product.max_quantity} className="pdp-cart-form"/>
        </>}
        <div className="pdp-vehicle-check"><CircleAlert size={20}/><GarageButton vehicle={vehicle} variant="product"/></div>
        {vehicle?.vehicleId && enrichment?.vehicles.some(row => String(row.vehicleTypeId) === vehicle.vehicleId) && <p className="pdp-garage-match"><ClipboardCheck size={17}/>Garajındaki {vehicle.make} {vehicle.model}, bu ürünün uyumluluk listesinde yer alıyor.</p>}
        <p className={`pdp-stock ${!product.available ? "pdp-out-of-stock" : ""}`}><PackageCheck size={17}/>{product.stock_label}</p>
        <Link className="pdp-delivery" href="/bilgi/teslimat"><Truck size={32}/><span><strong>Teslimat bilgileri <Info size={14}/></strong><small>{product.source === "supplier" ? "Stok ve sevkiyat süresi sipariş sonrası teyit edilir." : "Parçaların tek noktadan hazırlanır ve gönderilir."}</small></span><ChevronRight size={18}/></Link>
        <dl className="pdp-spec-preview">{specifications.slice(0, 4).map(([label, value]) => <div key={label}><dt>{label}:</dt><dd>{value}</dd></div>)}</dl>
        <a className="pdp-show-all" href="#product-specifications">Tüm özellikleri göster</a>
        {!isB2B && <div className="pdp-summary-footer"><LoginButton className="pdp-service-login">B2B hesabınla özel fiyatlarını gör →</LoginButton></div>}
      </div>
    </div>
    <div className="pdp-benefits">
      <div><ShieldCheck size={23}/><span><strong>Güvenli alışveriş</strong><small>Fiyat ve sipariş bilgilerini hesabından takip et.</small></span></div>
      <div><Truck size={25}/><span><strong>Tek noktadan tedarik</strong><small>Parçaların Getirbakim operasyonunda bir araya gelir.</small></span></div>
      <div><RotateCcw size={23}/><span><strong>İade ve değişim</strong><small><Link href="/bilgi/teslimat">İade koşullarını ve sürecini incele.</Link></small></span></div>
      <div><ClipboardCheck size={23}/><span><strong>Araç uyumluluğu</strong><small>OEM kodunu, motor ve model bilgilerini karşılaştır.</small></span></div>
    </div>
  </section>
  <div className="pdp-information-area"><div className="shell pdp-information-layout">
    <div className="pdp-information-content">
      <section className="pdp-specifications" id="product-specifications" aria-labelledby="specifications-title">
        <h2 id="specifications-title">{title} {product.brand} {displayPartNumber} teknik bilgileri</h2>
        <dl style={{ "--spec-rows": Math.ceil(specifications.length / 2) } as CSSProperties}>{specifications.map(([label, value]) => <div key={label}><dt>{label}:</dt><dd>{value}</dd></div>)}</dl>
        {(enrichment?.description || product.description) && <p className="pdp-description">{enrichment?.description || product.description}</p>}
      </section>
      {enrichment && (enrichment.vehicles.length > 0 ? <ProductFitment vehicles={enrichment.vehicles}/> : enrichment.vehicleModels.length > 0 && <section className="pdp-section" id="uyumlu-araclar"><h2>Uyumlu araç modelleri</h2><div className="pdp-model-list">{enrichment.vehicleModels.map(model => <span key={model}>{model}</span>)}</div><p>Motor ve üretim yılı ayrıntıları henüz eklenmedi.</p></section>)}
      {references.length > 0 && <section className="pdp-section" id="oem-numaralari"><h2>{product.brand} {displayPartNumber} OEM ve muadil numaraları</h2><dl className="pdp-references" tabIndex={0} aria-label="OEM ve muadil numaraları">{references.map(([brand, codes]) => <div key={brand}><dt>{brand}</dt><dd>{codes.map(code => { const href = referenceHref(brand, code); return href ? <Link key={code} href={href}>{code}</Link> : <span key={code}>{code}</span>; })}</dd></div>)}</dl></section>}
      <section className="pdp-section pdp-help" id="urun-yardim"><Headphones size={30}/><div><h2>Bu ürün hakkında soruların mı var?</h2><p>{title} için ürün, uyumluluk ve sipariş bilgileri konusunda yardım al.</p><Link href="/bilgi/yardim">Yardım merkezine git <ChevronRight size={15}/></Link></div></section>
    </div>
    <nav className="pdp-section-menu" aria-label="Ürün bilgileri"><a href="#product-specifications">Ürün detayları</a>{hasFitment && <a href="#uyumlu-araclar">Uyumlu araçlar</a>}{references.length > 0 && <a href="#oem-numaralari">OEM ve muadil numaraları</a>}<a href="#urun-yardim">Bu ürün hakkında sorular</a></nav>
  </div></div></div>;
}
