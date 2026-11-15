import Image from "next/image";
import Link from "next/link";
import type {Account} from "@/modules/auth/session";
import {money,servicePrice,type CatalogProduct} from "@/modules/store/catalog";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {listPrice} from "@/modules/store/best-offer";
import {readableProductName} from "@/modules/store/product-name";
import {cardPartNumber} from "@/modules/store/product-override-display";
import {catalogPath,categoryPath} from "@/modules/seo/paths";
import {productPath} from "@/modules/seo/product-path";

export function HomeProductCard({product,image,partNumber,category,account}:{product:CatalogProduct;image?:CatalogProductImage;partNumber?:string;category?:{name:string;slug:string};account:Account|null}) {
  // The store brand and part number (#602): an admin's, else the supplier's.
  const title=readableProductName(product.name)+" "+product.display_brand+" "+cardPartNumber(product,partNumber??product.code);
  const href=productPath(product);
  const discounted=account?.approved&&account.role==="service";
  // A running campaign (#580): the regular price struck through on its own line, discounted like the price. The card's
  // heights are minimums, so the extra line grows it (and its carousel row) instead of overflowing; the end date stays
  // on the product page and the catalog card.
  const regular=product.unavailable||product.price_kurus===null?null:listPrice(product);
  return <article className="flex min-h-[360px] min-w-0 flex-col text-foreground max-md:min-h-80 max-[37.5rem]:min-h-[300px]">
    <Link className="flex h-[210px] shrink-0 items-start justify-center pb-[30px] max-md:h-[190px] max-md:pb-5 max-[37.5rem]:h-[170px]" href={href}>{image&&<Image src={image.src} width={180} height={180} alt={title} unoptimized className="size-[180px] max-w-full object-contain max-md:size-[170px] max-[37.5rem]:size-[150px]"/>}</Link>
    <div className="min-h-[84.5px] max-md:min-h-[78px]">
      <Link className="mb-[5px] block truncate text-[13px] leading-[19.5px] text-muted-foreground" href={category?categoryPath(category.slug):catalogPath}>{category?.name??"Yedek parçalar"}</Link>
      <Link className="line-clamp-3 text-sm leading-5 font-medium text-foreground hover:text-primary max-md:text-[13px] max-md:leading-[18px]" href={href}>{title}</Link>
    </div>
    <div className="mt-2 min-h-[42px]">{product.unavailable?<Link className="text-[13px] leading-5 text-muted-foreground hover:text-primary" href={href+"#haber-ver"}>Şu an tedarik edilemiyor · Gelince haber ver</Link>:product.price_kurus===null?<span className="text-[13px] leading-5 text-muted-foreground">Fiyat bilgisi güncelleniyor</span>:<><strong className="block text-base leading-[21px] font-medium">{money(servicePrice(product.price_kurus,discounted?account!.discount_percent:0))}</strong>{regular!==null&&<s className="block text-[13px] leading-[18px] text-muted-foreground"><span className="sr-only">Önceki fiyat: </span>{money(servicePrice(regular,discounted?account!.discount_percent:0))}</s>}<small className="block text-[13px] leading-[21px] text-muted-foreground">KDV dahil · Kargo hariç</small></>}</div>
  </article>;
}
