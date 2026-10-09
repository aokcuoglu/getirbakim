"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, SlidersHorizontal } from "lucide-react";
import { Select } from "@/components/ui/select";

import {CategoryTree} from "@/components/navigation/category-tree";
import type {StoreCategory} from "@/modules/store/category-tree";
import type {CatalogQuery} from "@/modules/store/catalog-query";
import {selectedBrands,selectedAttributes,specificationValue,type CatalogFacet} from "@/modules/store/catalog-filters";
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
function FilterGroup({label,options,selected,onToggle,searchable=true}:{label:string;options:{value:string;label:string}[];selected:string[];onToggle:(value:string)=>void;searchable?:boolean}){
 const [search,setSearch]=useState("");
 return <details className="listing-facet-panel" open><summary><strong>{label}</strong><span className="facet-sign" aria-hidden="true"/></summary>
 {searchable&&<label className="listing-search"><Image className="filter-search-icon" src="/media/trodo/icons/search.svg" width={20} height={20} alt="" unoptimized/><input type="search" aria-label={label+" ara"} placeholder="Ara" value={search} onChange={e=>setSearch(e.target.value)}/></label>}
 <div className="listing-facet-options">{options.filter(o=>o.label.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr"))).map(option=><label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} disabled={!selected.includes(option.value)&&selected.length>=30} onChange={()=>onToggle(option.value)}/><span>{option.label}</span></label>)}</div>
 {!options.length&&<p className="facet-empty">Bu kategoride kayıt bulunamadı.</p>}
 </details>;
}
export function CatalogSidebar({categories,brands,facets,params}:{categories:StoreCategory[];brands:string[];facets:CatalogFacet[];params:Query}) {
 const filters=useRef<HTMLDetailsElement>(null);const router=useRouter();
 useEffect(()=>{const mobile=window.matchMedia("(max-width: 768px)");const update=()=>{if(filters.current)filters.current.open=!mobile.matches;};update();mobile.addEventListener("change",update);return()=>mobile.removeEventListener("change",update);},[]);
 const selected=selectedBrands(params),attributes=selectedAttributes(params);
 const active=categories.find(c=>c.slug===params.category),parent=categories.find(c=>c.id===active?.parentId);
 function toggle(list:string[],value:string){return list.includes(value)?list.filter(v=>v!==value):[...list,value];}
 function change(updates:Partial<Query>){router.push(catalogUrl(params,updates),{scroll:false});}
 return <aside className="listing-sidebar"><details className="listing-filter-panel" ref={filters} open><summary><SlidersHorizontal size={17}/><span>Filtreler</span><ChevronDown size={16}/></summary><div className="listing-filter-content">
 <section className="listing-category-panel"><h2><Link aria-label="Üst kategori" href={parent?catalogUrl(params,{category:parent.slug,attributes:undefined,brands:undefined,brand:undefined}):params.make?`/car-parts/${params.make}`:"/katalog"}><ChevronLeft size={16}/></Link>{parent?.name??"Kategoriler"}</h2><nav aria-label="Katalog kategorileri"><CategoryTree categories={categories} selected={params.category} href={slug=>catalogUrl(params,{category:slug,brand:undefined,brands:undefined,attributes:undefined,availability:undefined})}/></nav></section>
 <div className="listing-facets"><FilterGroup label="Üretici" options={brands.map(value=>({value,label:value}))} selected={selected} onToggle={value=>{const next=toggle(selected,value);change({brand:undefined,brands:next.length?JSON.stringify(next):undefined});}}/>
 {facets.map(facet=><FilterGroup key={facet.key} searchable={facet.key!=="Brand class"} label={facet.label} options={facet.values.map(value=>({value,label:specificationValue(value)}))} selected={attributes[facet.key]??[]} onToggle={value=>{const next={...attributes,[facet.key]:toggle(attributes[facet.key]??[],value)};if(!next[facet.key].length)delete next[facet.key];change({attributes:Object.keys(next).length?JSON.stringify(next):undefined});}}/>)}
 <FilterGroup label="Stok durumu" searchable={false} options={[{value:"in_stock",label:"Stokta mevcut"},{value:"out_of_stock",label:"Stokta yok"}]} selected={params.availability?[params.availability]:[]} onToggle={value=>change({availability:params.availability===value?undefined:value as Query["availability"]})}/>
 </div>
 {(selected.length>0||Object.keys(attributes).length>0||params.availability)&&<Link className="listing-clear" href={catalogUrl(params,{brand:undefined,brands:undefined,attributes:undefined,availability:undefined})}>Filtreleri temizle</Link>}
 </div></details></aside>;
}
export function CatalogResults({count,page,pages,pageSize,params,children,defaultView="grid"}:{count:number;page:number;pages:number;pageSize:number;params:Query;children:ReactNode;defaultView?:"list"|"grid"}) {
 const [view,setView]=useState(defaultView);const router=useRouter();
 return <ComparisonProvider><div className={`listing-results ${view==="grid" ? "grid-view" : ""}`}><div className="listing-toolbar"><span>{count ? `${(page-1)*pageSize+1} – ${Math.min(page*pageSize,count)} / ${count.toLocaleString("tr-TR")} ürün` : "0 ürün"}</span><div className="listing-toolbar-controls"><div className="listing-view"><button type="button" aria-label="Liste görünümü" aria-pressed={view==="list"} onClick={()=>setView("list")}><Image src="/media/trodo/icons/layout-list.svg" width={24} height={24} alt="" unoptimized/></button><button type="button" aria-label="Izgara görünümü" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><Image src="/media/trodo/icons/layout-grid.svg" width={24} height={24} alt="" unoptimized/></button></div><Select name="sort" label="Ürünleri sırala" value={params.sort ?? "newest"} options={[{value:"newest",label:"Son eklenenler"},{value:"price-asc",label:"Fiyat: düşükten yükseğe"},{value:"price-desc",label:"Fiyat: yüksekten düşüğe"}]} onChange={sort=>router.push(catalogUrl(params,{sort:sort as Query["sort"]}))}/></div></div><div className="listing-items">{children}</div>{pages>1 && <nav className="catalog-pagination" aria-label="Katalog sayfaları">{page>1 && <Link className="button" href={catalogUrl(params,{page:String(page-1)})}>Önceki sayfa</Link>}<span>Sayfa {page} / {pages}</span>{page<pages && <Link className="button" href={catalogUrl(params,{page:String(page+1)})}>Sonraki sayfa</Link>}</nav>}</div></ComparisonProvider>;
}
