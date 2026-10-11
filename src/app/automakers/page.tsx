import Image from "next/image";
import Link from "next/link";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,popularVehicleMakes} from "@/modules/store/vehicle-catalog";
import {getVehicleLogo} from "@/modules/store/storefront-logos";
import {Breadcrumb,BreadcrumbItem,BreadcrumbLink,BreadcrumbList,BreadcrumbPage,BreadcrumbSeparator} from "@/components/ui/breadcrumb";

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
  return <li key={brand.id}><Link href={"/car-parts/"+vehicleBrandSlug(brand.name)} aria-label={brand.name+" yedek parçaları"} className="flex h-[88px] flex-col items-center justify-center gap-2 rounded-md border border-border bg-white p-2.5 text-center text-xs leading-4 font-medium text-foreground hover:border-brand hover:text-primary max-md:h-20">
   {logo?<Image src={logo.src} width={logo.width} height={logo.height} alt="" unoptimized className="h-[42px] w-[92px] max-w-full object-contain"/>:<span className="grid size-[42px] place-items-center rounded-full bg-muted text-sm font-semibold tracking-[.5px] text-muted-foreground" aria-hidden="true">{displayName(brand.name).slice(0,2)}</span>}
   <span className="max-w-full wrap-anywhere">{displayName(brand.name)}</span>
  </Link></li>;};
 const grid="grid list-none grid-cols-6 gap-4 max-lg:grid-cols-4 max-md:grid-cols-3 max-md:gap-2";
 const h2="mt-8 mb-4 text-[22px] leading-7 font-semibold tracking-[-.4px]";
 return <div className="bg-white text-foreground">
  <section className="mx-auto w-full max-w-[1280px] px-8 pt-6 pb-16 max-[37.5rem]:px-5">
   <Breadcrumb aria-label="Sayfa yolu" className="mb-7"><BreadcrumbList className="gap-[9px] text-[13px] leading-5"><BreadcrumbItem><BreadcrumbLink render={<Link href="/"/>} className="inline-flex min-h-8 items-center hover:text-brand hover:underline">Ana sayfa</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="[&>svg]:size-[13px]"/><BreadcrumbItem><BreadcrumbPage className="text-muted-foreground">Araç markaları</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
   <h1 className="mt-4 mb-2 text-[32px] leading-10 font-semibold tracking-[-.5px] max-md:text-[26px] max-md:leading-8">Araç markaları</h1>
   <p className="mb-8 max-w-[720px] text-[15px] leading-[22px] text-muted-foreground">Aracının markasını seç, o markanın modellerine uygun listelenen yedek parçaları kategori ve üreticiye göre incele.</p>
   {popular.length>0&&<section aria-labelledby="automakers-popular"><h2 id="automakers-popular" className={h2}>Popüler araç markaları</h2><ul className={grid}>{popular.map(tile)}</ul></section>}
   <section aria-labelledby="automakers-all"><h2 id="automakers-all" className={h2}>Tüm araç markaları</h2>
    <nav className="sticky top-0 z-[1] mb-2 flex flex-wrap gap-1 bg-white py-2 max-md:flex-nowrap max-md:overflow-x-auto" aria-label="Harfe göre markalar">{groups.map(([letter])=><a key={letter} href={"#marka-"+letter} className="grid h-8 min-w-8 shrink-0 place-items-center rounded-[4px] border border-border text-[13px] font-semibold text-foreground hover:border-brand hover:text-primary">{letter}</a>)}</nav>
    {groups.map(([letter,items])=><section key={letter} id={"marka-"+letter} className="scroll-mt-14" aria-label={letter}><h3 className="mt-6 mb-3 text-lg leading-6 font-semibold">{letter}</h3><ul className={grid}>{items.map(tile)}</ul></section>)}
   </section>
  </section>
 </div>;
}
