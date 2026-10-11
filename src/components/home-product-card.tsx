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
  return <article className="flex h-[360px] min-w-0 flex-col text-foreground max-md:h-80 max-[37.5rem]:h-[300px]">
    <Link className="flex h-[210px] shrink-0 items-start justify-center pb-[30px] max-md:h-[190px] max-md:pb-5 max-[37.5rem]:h-[170px]" href={"/urun/"+product.id}>{image&&<Image src={image.src} width={180} height={180} alt={title} unoptimized className="size-[180px] max-w-full object-contain max-md:size-[170px] max-[37.5rem]:size-[150px]"/>}</Link>
    <div className="min-h-[84.5px] max-md:min-h-[78px]">
      <Link className="mb-[5px] block truncate text-[13px] leading-[19.5px] text-muted-foreground" href={category?"/katalog?category="+category.slug:"/katalog"}>{category?.name??"Yedek parçalar"}</Link>
      <Link className="line-clamp-3 text-sm leading-5 font-medium text-foreground hover:text-primary max-md:text-[13px] max-md:leading-[18px]" href={"/urun/"+product.id}>{title}</Link>
    </div>
    <div className="mt-2 min-h-[42px]">{product.price_kurus===null?<span className="text-[13px] leading-5 text-muted-foreground">Fiyat bilgisi güncelleniyor</span>:<><strong className="block text-base leading-[21px] font-medium">{money(servicePrice(product.price_kurus,discounted?account!.discount_percent:0))}</strong><small className="block text-[13px] leading-[21px] text-muted-foreground">KDV dahil · Kargo hariç</small></>}</div>
  </article>;
}
