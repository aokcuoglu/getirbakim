import Link from "next/link";
import Image from "next/image";
import { PackageCheck, Info, ChevronDown } from "lucide-react";
import { PartArt } from "@/components/part-art";
import { categories, money, servicePrice, type CatalogProduct as CatalogEntry } from "@/modules/store/catalog";
import type { Account } from "@/modules/auth/session";
import type { CatalogProductImage } from "@/modules/store/product-enrichment";
import { updateCart } from "@/app/sepet/actions";
import { ManufacturerBadge } from "@/components/manufacturer-badge";
import type { ManufacturerLogo } from "@/modules/store/manufacturer-logos";

export function CatalogProduct({ product: p, image, logo, account }: { product: CatalogEntry; image?: CatalogProductImage; logo?: ManufacturerLogo; account: Account | null }) {
  const discounted = Boolean(account?.approved && account.role === "service");
  const category = categories.find(c => c.slug === p.category);
  return <article className="listing-product">
    <div className="listing-product-media">
      <ManufacturerBadge brand={p.brand} logo={logo} className="listing-brand-badge"/>
      <Link href={`/urun/${p.id}`} aria-label={p.name}>{image
        ? <Image className="listing-product-image" src={image.src} width={image.width} height={image.height} alt={`${p.brand} ${p.code} ${p.name}`} loading="lazy" unoptimized />
        : <PartArt kind={category?.art} />}</Link>
      {p.supplier === "demo" && <small className="listing-demo">Örnek ürün</small>}
    </div>
    <div className="listing-product-content">
      <div className="listing-product-heading">
        <Link className="listing-product-name" href={`/urun/${p.id}`}>{p.name}</Link>
        <p className="product-code">Ürün kodu: <span>{p.code}</span></p>
        {p.oem && <p className="product-code listing-oem">OEM: <span>{p.oem}</span></p>}
      </div>
      <details className="listing-specs"><summary>Teknik bilgiler <ChevronDown size={15} aria-hidden="true" /></summary>
        <dl><div><dt>Üretici</dt><dd>{p.brand}</dd></div>{category && <div><dt>Kategori</dt><dd>{category.name}</dd></div>}{p.description && <div><dt>Açıklama</dt><dd>{p.description}</dd></div>}</dl>
        <Link className="listing-all-details" href={`/urun/${p.id}`}>Tüm özellikleri göster →</Link>
      </details>
      <div className="listing-product-buy">
        {p.price_kurus === null ? <div className="purchase-box"><p>Fiyat bilgisi güncelleniyor</p><p>{p.stock_label}</p><small>Güncel fiyat alındığında siparişe açılacak.</small></div> : <>
          <div className="listing-price">{money(servicePrice(p.price_kurus!, discounted ? account!.discount_percent : 0))}</div>
          <div className="listing-price-note">KDV dahil · {discounted ? "Servisine özel B2B fiyatı" : "Bireysel satış fiyatı"}</div>
          <p className={`listing-stock ${p.available ? "" : "unavailable"}`}><PackageCheck size={16}/>{p.stock_label}</p>
          <form action={updateCart} className="listing-purchase">
            <input type="hidden" name="productId" value={p.id}/><input type="hidden" name="mode" value="add"/>
            <input aria-label={`${p.name} için adet`} type="number" name="quantity" min={1} max={p.max_quantity} defaultValue={1} required disabled={!p.available}/>
            <button disabled={!p.available}>{p.available ? "Sepete ekle" : "Stokta yok"}</button>
          </form>
        </>}
        <Link className="listing-safety" href="/bilgi/uyumluluk"><Info size={14}/> Uyumluluğu kontrol et</Link>
      </div>
    </div>
  </article>;
}
