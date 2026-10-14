"use client";
import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { categoryPath, type StoreCategory } from "@/modules/store/category-tree";
import type {CatalogQuery} from "@/modules/store/catalog-query";
import {selectedBrands,selectedAttributes,specificationValue,type CatalogFacet} from "@/modules/store/catalog-filters";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import {ComparisonProvider} from "./catalog-card-controls";

type Query=CatalogQuery;
// A vehicle make lives in the path (/car-parts/{make}), every other filter in the query string.
function catalogUrl(params:Query, updates:Partial<Query>) {
 const {make,...rest}={...params,page:undefined,...updates};
 const query=new URLSearchParams();
 Object.entries(rest).forEach(([key,value])=>{if(value)query.set(key,value);});
 const path=make?`/car-parts/${make}`:"/katalog";
 return query.size?`${path}?${query}`:path;
}
const searchBox="flex h-10 items-center gap-2 rounded-md border border-input bg-white px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50";
const searchInput="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted-foreground";
// Children of the active category (or the top level), with a search across the whole tree.
function SidebarCategoryTree({categories,selected,href}:{categories:StoreCategory[];selected?:string;href:(slug:string)=>string}){
 const [search,setSearch]=useState("");
 const active=categories.find(c=>c.slug===selected);
 const branchNodes=active?categories.filter(c=>c.parentId===active.id):[...categories.filter(c=>c.parentId===3),...categories.filter(c=>c.parentId===null&&c.id!==3)];
 const shown=branchNodes.length?branchNodes:categories.filter(c=>c.parentId===active?.parentId);
 const term=search.trim().toLocaleLowerCase("tr");
 const matches=categories.filter(c=>c.name.toLocaleLowerCase("tr").includes(term));
 const item="flex min-h-[30px] items-center justify-between py-[5px] pr-[35px] pl-[25px] text-sm leading-5 font-medium text-foreground transition-colors hover:text-brand aria-[current=page]:bg-[#f8f9f9] aria-[current=page]:text-foreground";
 return <div>
  <label className={cn(searchBox,"mx-[25px] mb-[15px]")}><Search size={16} aria-hidden="true" className="shrink-0"/><input type="search" className={searchInput} aria-label="Kategori ara" placeholder="Kategori ara" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  {term?<ul>{matches.map(c=><li key={c.id}><Link className={cn(item,"block")} href={href(c.slug)} aria-current={c.slug===selected?"page":undefined}>{c.name}<small className="mt-[3px] block text-[11px] leading-normal font-normal text-muted-foreground">{categoryPath(categories,c.id).slice(0,-1).map(n=>n.name).join(" / ")}</small></Link></li>)}{!matches.length&&<li className="px-[25px] text-sm leading-[22px] text-muted-foreground">Kategori bulunamadı.</li>}</ul>
  :<ul>{shown.map(c=><li key={c.id}><Link className={item} href={href(c.slug)} aria-current={c.slug===selected?"page":undefined}><span>{c.name}</span>{categories.some(n=>n.parentId===c.id)&&<ChevronRight size={14} aria-hidden="true"/>}</Link></li>)}</ul>}
 </div>;
}
// Long option lists (182 makers) render their first entries until opened or searched: each checkbox
// is ~1 kB of markup, and the box only shows about ten at a time anyway.
const collapsedOptions=12;
function FilterGroup({label,options,selected,onToggle,searchable=true}:{label:string;options:{value:string;label:string}[];selected:string[];onToggle:(value:string)=>void;searchable?:boolean}){
 const [search,setSearch]=useState("");
 const [showAll,setShowAll]=useState(false);
 const matching=options.filter(o=>o.label.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")));
 const visible=search||showAll?matching:matching.filter((option,index)=>index<collapsedOptions||selected.includes(option.value));
 return <Collapsible defaultOpen className="border-b border-border last:border-b-0">
 <CollapsibleTrigger className="group/facet flex min-h-[50px] w-full cursor-pointer rounded-none border-0 bg-transparent text-foreground items-center justify-between px-[25px] py-[15px] text-left text-base leading-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"><strong className="font-bold">{label}</strong><span aria-hidden="true" className="text-xl font-medium group-data-panel-open/facet:hidden">+</span><span aria-hidden="true" className="hidden text-xl font-medium group-data-panel-open/facet:inline">−</span></CollapsibleTrigger>
 <CollapsibleContent>
 {searchable&&<label className="relative mx-[25px] mb-[15px] block pt-[5px]"><Image className="absolute top-[15px] left-2.5" src="/media/site/icons/search.svg" width={20} height={20} alt="" unoptimized/><input type="search" className="h-10 w-full rounded-md border border-input bg-white py-2 pr-2.5 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={label+" ara"} placeholder="Ara" value={search} onChange={e=>setSearch(e.target.value)}/></label>}
 <div className="max-h-[300px] overflow-auto px-[25px] pt-[5px] pb-[25px]">{visible.map(option=><label key={option.value} className="mb-2.5 flex min-h-5 cursor-pointer items-center gap-2 text-sm leading-5 font-normal has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60">
  <Checkbox className="size-5 rounded-[4px] border-input bg-white data-checked:border-brand data-checked:bg-brand [&_svg]:size-3.5!" checked={selected.includes(option.value)} disabled={!selected.includes(option.value)&&selected.length>=30} onCheckedChange={()=>onToggle(option.value)}/><span>{option.label}</span></label>)}
  {visible.length<matching.length&&<button type="button" className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-brand-strong hover:underline" onClick={()=>setShowAll(true)}>Tümünü göster ({matching.length.toLocaleString("tr-TR")})</button>}</div>
 {!options.length&&<p className="px-[25px] pb-[25px] text-[13px] text-muted-foreground">Bu kategoride kayıt bulunamadı.</p>}
 </CollapsibleContent>
 </Collapsible>;
}
export function CatalogSidebar({categories,brands,facets,params}:{categories:StoreCategory[];brands:string[];facets:CatalogFacet[];params:Query}) {
 const router=useRouter();
 // Open on desktop, folded behind the "Filtreler" toggle on phones.
 const [open,setOpen]=useState(true);
 useEffect(()=>{const mobile=window.matchMedia("(max-width: 768px)");const update=()=>setOpen(!mobile.matches);update();mobile.addEventListener("change",update);return()=>mobile.removeEventListener("change",update);},[]);
 const selected=selectedBrands(params),attributes=selectedAttributes(params);
 const active=categories.find(c=>c.slug===params.category),parent=categories.find(c=>c.id===active?.parentId);
 function toggle(list:string[],value:string){return list.includes(value)?list.filter(v=>v!==value):[...list,value];}
 function change(updates:Partial<Query>){router.push(catalogUrl(params,updates),{scroll:false});}
 return <aside className="min-w-0"><Collapsible open={open} onOpenChange={setOpen}>
 <CollapsibleTrigger className="group/filters hidden min-h-12 w-full cursor-pointer justify-start text-foreground items-center gap-2 rounded-md border border-input bg-white px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-panel-open:mb-4 max-[768px]:flex"><SlidersHorizontal size={17}/><span>Filtreler</span><ChevronDown size={16} className="ml-auto transition-transform group-data-panel-open/filters:rotate-180"/></CollapsibleTrigger>
 <CollapsibleContent>
 <section className="mb-[15px] rounded-[4px] border border-border bg-white py-[25px]"><h2 className="mb-[15px] flex items-center gap-2.5 px-[25px] text-base leading-6 font-semibold"><Link className="grid size-6 place-items-center rounded-[3px] bg-[#f1f3f5] hover:bg-[#e6e9ec]" aria-label="Üst kategori" href={parent?catalogUrl(params,{category:parent.slug,attributes:undefined,brands:undefined,brand:undefined}):params.make?`/car-parts/${params.make}`:"/katalog"}><ChevronLeft size={16}/></Link>{parent?.name??"Kategoriler"}</h2><nav aria-label="Katalog kategorileri"><SidebarCategoryTree categories={categories} selected={params.category} href={slug=>catalogUrl(params,{category:slug,brand:undefined,brands:undefined,attributes:undefined,availability:undefined})}/></nav></section>
 <div className="overflow-hidden rounded-[4px] border border-border bg-white"><FilterGroup label="Üretici" options={brands.map(value=>({value,label:value}))} selected={selected} onToggle={value=>{const next=toggle(selected,value);change({brand:undefined,brands:next.length?JSON.stringify(next):undefined});}}/>
 {facets.map(facet=><FilterGroup key={facet.key} searchable={facet.key!=="Brand class"} label={facet.label} options={facet.values.map(value=>({value,label:specificationValue(value)}))} selected={attributes[facet.key]??[]} onToggle={value=>{const next={...attributes,[facet.key]:toggle(attributes[facet.key]??[],value)};if(!next[facet.key].length)delete next[facet.key];change({attributes:Object.keys(next).length?JSON.stringify(next):undefined});}}/>)}
 <FilterGroup label="Stok durumu" searchable={false} options={[{value:"in_stock",label:"Stokta mevcut"},{value:"out_of_stock",label:"Stokta yok"}]} selected={params.availability?[params.availability]:[]} onToggle={value=>change({availability:params.availability===value?undefined:value as Query["availability"]})}/>
 </div>
 {(selected.length>0||Object.keys(attributes).length>0||params.availability)&&<Link className="mt-[15px] block text-[13px] text-brand-strong hover:underline" href={catalogUrl(params,{brand:undefined,brands:undefined,attributes:undefined,availability:undefined})}>Filtreleri temizle</Link>}
 </CollapsibleContent></Collapsible></aside>;
}
const pageButton="h-12 rounded-md border-brand bg-brand px-[27px] text-sm text-white hover:bg-brand-strong";
export function CatalogResults({count,page,pages,pageSize,params,children,defaultView="grid"}:{count:number;page:number;pages:number;pageSize:number;params:Query;children:ReactNode;defaultView?:"list"|"grid"}) {
 const [view,setView]=useState(defaultView);const router=useRouter();
 const viewButton="h-7 min-h-7 w-[22px] rounded-none border-0 bg-transparent p-0 hover:bg-transparent [&>img]:opacity-20 aria-pressed:[&>img]:opacity-100";
 return <ComparisonProvider><div className="group/listing min-w-0" data-view={view}>
 <div className="mb-[25px] flex min-h-[42px] items-center justify-between gap-4 max-[600px]:flex-wrap max-[600px]:gap-3"><span className="text-sm leading-5 text-foreground max-[600px]:text-xs">{count ? `${(page-1)*pageSize+1} – ${Math.min(page*pageSize,count)} / ${count.toLocaleString("tr-TR")} ürün` : "0 ürün"}</span>
 <div className="flex items-center gap-[15px] max-[600px]:gap-2.5">
  <div className="flex h-[42px] items-center gap-3 rounded-md border border-input px-3 py-1 max-[600px]:gap-2 max-[600px]:px-2">
   <Button variant="ghost" className={viewButton} aria-label="Liste görünümü" aria-pressed={view==="list"} onClick={()=>setView("list")}><Image src="/media/site/icons/layout-list.svg" width={24} height={24} alt="" unoptimized/></Button>
   <Button variant="ghost" className={viewButton} aria-label="Izgara görünümü" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><Image src="/media/site/icons/layout-grid.svg" width={24} height={24} alt="" unoptimized/></Button>
  </div>
  <NativeSelect name="sort" aria-label="Ürünleri sırala" value={params.sort ?? (params.q ? "relevance" : "newest")} onChange={event=>router.push(catalogUrl(params,{sort:event.target.value as Query["sort"]}))}
   className="w-[180px] max-[600px]:w-[150px] max-[380px]:w-[145px] [&>select]:h-[42px] [&>select]:rounded-md [&>select]:bg-white [&>select]:pr-[30px] [&>select]:pl-3 [&>select]:text-sm [&>svg]:text-foreground">
   {params.q&&<NativeSelectOption value="relevance">En alakalı</NativeSelectOption>}<NativeSelectOption value="newest">Son eklenenler</NativeSelectOption><NativeSelectOption value="price-asc">Fiyat: düşükten yükseğe</NativeSelectOption><NativeSelectOption value="price-desc">Fiyat: yüksekten düşüğe</NativeSelectOption>
  </NativeSelect>
 </div></div>
 <div className="flex flex-col gap-4 group-data-[view=grid]/listing:mx-[-2px] group-data-[view=grid]/listing:grid group-data-[view=grid]/listing:grid-cols-3 group-data-[view=grid]/listing:items-stretch group-data-[view=grid]/listing:gap-x-4 group-data-[view=grid]/listing:gap-y-6 max-[992px]:group-data-[view=grid]/listing:grid-cols-2 max-[600px]:group-data-[view=grid]/listing:mx-0 max-[600px]:group-data-[view=grid]/listing:gap-x-2 max-[600px]:group-data-[view=grid]/listing:gap-y-4 max-[380px]:group-data-[view=grid]/listing:grid-cols-1">{children}</div>
 {pages>1 && <Pagination aria-label="Katalog sayfaları" className="mt-[25px]"><PaginationContent className="flex-wrap justify-center gap-4 text-sm">
  {page>1 && <PaginationItem><Button className={pageButton} nativeButton={false} render={<Link href={catalogUrl(params,{page:String(page-1)})}/>}>Önceki sayfa</Button></PaginationItem>}
  <PaginationItem><span>Sayfa {page} / {pages}</span></PaginationItem>
  {page<pages && <PaginationItem><Button className={pageButton} nativeButton={false} render={<Link href={catalogUrl(params,{page:String(page+1)})}/>}>Sonraki sayfa</Button></PaginationItem>}
 </PaginationContent></Pagination>}
 </div></ComparisonProvider>;
}
