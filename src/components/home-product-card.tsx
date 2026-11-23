import type {Account} from "@/modules/auth/session";
import type {CatalogProduct} from "@/modules/store/catalog";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {homeCardModel} from "@/modules/store/listing-card";
import {HomeProductCardView} from "./home-product-card-view";

// The texts and prices are finished here (an approved service account's discount included) and the client view renders them (#1212).
export function HomeProductCard({product,image,partNumber,category,account}:{product:CatalogProduct;image?:CatalogProductImage;partNumber?:string;category?:{name:string;slug:string};account:Account|null}) {
  const discountPercent=account?.approved&&account.role==="service"?account.discount_percent:0;
  return <HomeProductCardView model={homeCardModel({product,image,partNumber,category,discountPercent})}/>;
}
