import type {Account} from "@/modules/auth/session";
import {money,servicePrice,type CatalogProduct} from "@/modules/store/catalog";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {listPrice} from "@/modules/store/best-offer";
import {shownProductName} from "@/modules/store/product-name";
import {cardPartNumber} from "@/modules/store/product-override-display";
import {catalogPath,categoryPath} from "@/modules/seo/paths";
import {productPath} from "@/modules/seo/product-path";
import {HomeProductCardView,type HomeProductCardModel} from "./home-product-card-view";

// The texts and prices are finished here (an approved service account's discount included) and the client view renders them (#1212).
export function HomeProductCard({product,image,partNumber,category,account}:{product:CatalogProduct;image?:CatalogProductImage;partNumber?:string;category?:{name:string;slug:string};account:Account|null}) {
  // The store brand and part number (#602): an admin's, else the supplier's.
  const title=shownProductName(product)+" "+product.display_brand+" "+cardPartNumber(product,partNumber??product.code);
  const href=productPath(product);
  const discount=account?.approved&&account.role==="service"?account.discount_percent:0;
  // A running campaign (#580): the regular price struck through on its own line, discounted like the price. The card's
  // heights are minimums, so the extra line grows it (and its carousel row) instead of overflowing; the end date stays
  // on the product page and the catalog card.
  const regular=product.unavailable||product.price_kurus===null?null:listPrice(product);
  const model:HomeProductCardModel={
    href,title,...(image&&{image:image.src}),
    categoryHref:category?categoryPath(category.slug):catalogPath,categoryName:category?.name??"Yedek parçalar",
    ...(product.unavailable?{note:{text:product.stock_label+" · Gelince haber ver",href:href+"#haber-ver"}}
      :product.price_kurus===null?{note:{text:"Fiyat bilgisi güncelleniyor"}}
      :{amount:money(servicePrice(product.price_kurus,discount))}),
    ...(regular!==null&&{regular:money(servicePrice(regular,discount))}),
  };
  return <HomeProductCardView model={model}/>;
}
