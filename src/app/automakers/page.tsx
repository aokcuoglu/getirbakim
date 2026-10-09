import Image from "next/image";
import Link from "next/link";
import {ChevronRight} from "lucide-react";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,popularVehicleMakes} from "@/modules/store/vehicle-catalog";
import {getVehicleLogo} from "@/modules/store/storefront-logos";
import "@/styles/catalog.css";
import "@/styles/automakers.css";

export const metadata={title:"Araç markaları | Getirbakim",
 description:"Tüm araç markalarını incele ve aracının markasına uygun yedek parçaları keşfet.",
 alternates:{canonical:"/automakers"}};

const displayName=(name:string)=>name==="VOLKSWAGEN"?"VW":name;
// Group under the plain Latin initial so "CITROËN" sits with C; digits share one group.
const initial=(name:string)=>{const letter=vehicleBrandSlug(name).charAt(0).toUpperCase();return /[A-Z]/.test(letter)?letter:"0-9";};

export default async function Automakers() {
 const brands=await getVehicleBrands();
 const groups=[...Map.groupBy(brands,brand=>initial(brand.name))].sort(([a],[b])=>a.localeCompare(b));
 const popular=popularVehicleMakes.flatMap(name=>brands.filter(brand=>brand.name===name));
 const tile=(brand:typeof brands[number])=>{const logo=getVehicleLogo(brand.name);
  return <li key={brand.id}><Link href={"/car-parts/"+vehicleBrandSlug(brand.name)} aria-label={brand.name+" yedek parçaları"}>
   {logo?<Image src={logo.src} width={logo.width} height={logo.height} alt="" unoptimized/>:<span className="automaker-monogram" aria-hidden="true">{displayName(brand.name).slice(0,2)}</span>}
   <span>{displayName(brand.name)}</span>
  </Link></li>;};
 return <div className="catalog-page automakers-page">
  <section className="shell automakers-body">
   <nav className="breadcrumbs" aria-label="Sayfa yolu"><Link href="/">Ana sayfa</Link><ChevronRight size={13}/><span aria-current="page">Araç markaları</span></nav>
   <h1>Araç markaları</h1>
   <p className="automakers-lead">Aracının markasını seç, o markanın modellerine uygun listelenen yedek parçaları kategori ve üreticiye göre incele.</p>
   {popular.length>0&&<section aria-labelledby="automakers-popular"><h2 id="automakers-popular">Popüler araç markaları</h2><ul className="automakers-grid">{popular.map(tile)}</ul></section>}
   <section aria-labelledby="automakers-all"><h2 id="automakers-all">Tüm araç markaları</h2>
    <nav className="automakers-letters" aria-label="Harfe göre markalar">{groups.map(([letter])=><a key={letter} href={"#marka-"+letter}>{letter}</a>)}</nav>
    {groups.map(([letter,items])=><section key={letter} id={"marka-"+letter} className="automakers-group" aria-label={letter}><h3>{letter}</h3><ul className="automakers-grid">{items.map(tile)}</ul></section>)}
   </section>
  </section>
 </div>;
}
