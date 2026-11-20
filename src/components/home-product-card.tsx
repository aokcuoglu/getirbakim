import Image from "next/image";
import Link from "next/link";
import type {Account} from "@/modules/auth/session";
import {money,servicePrice,type CatalogProduct} from "@/modules/store/catalog";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {listPrice} from "@/modules/store/best-offer";
import {shownProductName} from "@/modules/store/product-name";
import {cardPartNumber} from "@/modules/store/product-override-display";
import {catalogPath,categoryPath} from "@/modules/seo/paths";
import {productPath} from "@/modules/seo/product-path";

export function HomeProductCard({product,image,partNumber,category,account}:{product:CatalogProduct;image?:CatalogProductImage;partNumber?:string;category?:{name:string;slug:string};account:Account|null}) {
  // The store brand and part number (#602): an admin's, else the supplier's.
  const title=shownProductName(product)+" "+product.display_brand+" "+cardPartNumber(product,partNumber??product.code);
  const href=productPath(product);
  const discounted=account?.approved&&account.role==="service";
  // A running campaign (#580): the regular price struck through on its own line, discounted like the price. The card's
  // heights are minimums, so the extra line grows it (and its carousel row) instead of overflowing; the end date stays
  // on the product page and the catalog card.
  const regular=product.unavailable||product.price_kurus===null?null:listPrice(product);
  return <article className="home-card">
    <Link className="home-card-image" href={href}>{image&&<Image src={image.src} width={180} height={180} alt={title} className="home-card-img"/>}</Link>
    <div className="home-card-text">
      <Link className="home-card-category" href={category?categoryPath(category.slug):catalogPath}>{category?.name??"Yedek parçalar"}</Link>
      <Link className="home-card-title" href={href}>{title}</Link>
    </div>
    <div className="home-card-price">{product.unavailable?<Link className="home-card-note home-card-note-link" href={href+"#haber-ver"}>{product.stock_label} · Gelince haber ver</Link>:product.price_kurus===null?<span className="home-card-note">Fiyat bilgisi güncelleniyor</span>:<><strong className="home-card-amount">{money(servicePrice(product.price_kurus,discounted?account!.discount_percent:0))}</strong>{regular!==null&&<s className="home-card-regular"><span className="sr-only">Önceki fiyat: </span>{money(servicePrice(regular,discounted?account!.discount_percent:0))}</s>}<small className="home-card-tax">KDV dahil · Kargo hariç</small></>}</div>
  </article>;
}
