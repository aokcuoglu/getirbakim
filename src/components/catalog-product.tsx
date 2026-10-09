import Link from "next/link";
import Image from "next/image";
import {Info,Gauge} from "lucide-react";
import {PartArt} from "@/components/part-art";
import {categories,money,servicePrice,type CatalogProduct as CatalogEntry} from "@/modules/store/catalog";
import type {Account} from "@/modules/auth/session";
import type {CatalogProductImage} from "@/modules/store/product-enrichment";
import {updateCart} from "@/app/sepet/actions";
import {ManufacturerBadge} from "@/components/manufacturer-badge";
import type {ManufacturerLogo} from "@/modules/store/manufacturer-logos";
import {specificationValue} from "@/modules/store/catalog-filters";
import {CardSpecifications,CompareCheckbox} from "./catalog-card-controls";
type Details={specifications:[string,string][];vehicleSpecific:boolean;partNumber:string};
export function CatalogProduct({product:p,image,logo,account,details}:{product:CatalogEntry;image?:CatalogProductImage;logo?:ManufacturerLogo;account:Account|null;details?:Details}){
 const discounted=Boolean(account?.approved&&account.role==="service"),category=categories.find(c=>c.slug===p.category);
 const displayName=p.name.toLowerCase().replace(/\bon\b/g,"ön").split(" ").map(word=>word.charAt(0).toLocaleUpperCase("tr")+word.slice(1)).join(" ");
 const title=displayName+" "+p.brand+" "+(details?.partNumber??p.code).replace(new RegExp("^"+p.brand.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s+","i"),"");
 const specifications=details?.specifications??([["Üretici",p.brand],...(p.oem?[["OEM",p.oem]]:[])] as [string,string][]);
 const brandClass=details?.specifications.find(s=>s[0]==="Brand class")?.[1];
 const price=p.price_kurus===null?"Fiyat bilgisi güncelleniyor":money(servicePrice(p.price_kurus,discounted?account!.discount_percent:0));
 return <article className="listing-product">
 <div className="listing-product-media"><div className="listing-product-labels">{brandClass&&<span className={"brand-quality "+(brandClass==="Premium"?"premium":brandClass==="Budget"?"budget":"standard")} title={specificationValue(brandClass)} aria-label={specificationValue(brandClass)}>{brandClass==="Premium"||brandClass==="Budget"?<Image src={"/media/trodo/icons/"+brandClass.toLowerCase()+".svg"} width={16} height={16} alt="" unoptimized/>:<Gauge size={18}/>}</span>}<ManufacturerBadge brand={p.brand} logo={logo} className="listing-brand-badge"/></div>
 <Link href={"/urun/"+p.id} aria-label={title}>{image?<Image className="listing-product-image" src={image.src} width={image.width} height={image.height} alt={title} loading="lazy" unoptimized/>:<PartArt kind={category?.art}/>}</Link>{p.supplier==="demo"&&<small className="listing-demo">Örnek ürün</small>}</div>
 <div className="listing-product-content">
 <div className="listing-product-heading"><Link className="listing-product-name" href={"/urun/"+p.id}>{title}</Link><div className="listing-product-meta">{details?.vehicleSpecific&&<Link className="vehicle-specific" href={"/urun/"+p.id+"#uyumlu-araclar"}>ARACA ÖZEL</Link>}<span title={p.code}>Kod: {p.code}</span></div></div>
 <CardSpecifications specifications={specifications}/>
 <div className="listing-product-buy">
 <div className={"listing-price"+(p.price_kurus===null?" price-pending":"")}>{price}</div>{p.price_kurus!==null&&<div className="listing-price-note">KDV dahil <span>· Kargo hariç</span>{discounted&&<span> · Servisine özel fiyat</span>}</div>}
 <p className={"listing-stock"+(p.available?"":" unavailable")}><Image src="/media/trodo/icons/calendar-check.svg" width={20} height={20} alt="" unoptimized/>{p.stock_label}</p>
 <form action={updateCart} className="listing-purchase"><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="mode" value="add"/><input aria-label={p.name+" için adet"} type="number" name="quantity" min={1} max={p.max_quantity} defaultValue={1} required disabled={!(p.available&&p.price_kurus!==null)}/><button disabled={!(p.available&&p.price_kurus!==null)}>{p.available?"Sepete ekle":"Stokta yok"}</button></form>
 <CompareCheckbox entry={{id:p.id,title,price,specifications}}/>
 <Link className="listing-safety" href="/bilgi/uyumluluk"><Info size={14}/>Güvenlik ve uyumluluk bilgileri</Link>
 </div></div></article>;
}
