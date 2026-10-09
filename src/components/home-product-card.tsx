import Image from "next/image";
import Link from "next/link";
import type {Account} from "@/modules/auth/session";
import {money,servicePrice,type CatalogProduct} from "@/modules/store/catalog";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";

export function HomeProductCard({product,image,partNumber,category,account}:{product:CatalogProduct;image?:CatalogProductImage;partNumber?:string;category?:{name:string;slug:string};account:Account|null}) {
  const name=product.name.toLowerCase().replace(/\bon\b/g,"ön").split(" ").map(word=>word.charAt(0).toLocaleUpperCase("tr")+word.slice(1)).join(" ");
  const code=(partNumber??product.code).replace(new RegExp("^"+product.brand.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s+","i"),"");
  const title=name+" "+product.brand+" "+code;
  const discounted=account?.approved&&account.role==="service";
  return <article className="home-product-card">
    <Link className="home-product-image" href={"/urun/"+product.id}>{image&&<Image src={image.src} width={180} height={180} alt={title} unoptimized/>}</Link>
    <div className="home-product-heading"><Link className="home-product-category" href={category?"/katalog?category="+category.slug:"/katalog"}>{category?.name??"Yedek parçalar"}</Link><Link className="home-product-name" href={"/urun/"+product.id}>{title}</Link></div>
    <div className="home-product-price">{product.price_kurus===null?<span className="pending">Fiyat bilgisi güncelleniyor</span>:<><strong>{money(servicePrice(product.price_kurus,discounted?account!.discount_percent:0))}</strong><small>KDV dahil · Kargo hariç</small></>}</div>
  </article>;
}
