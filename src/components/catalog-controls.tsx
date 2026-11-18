"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { categoryPath, searchCategories, type SidebarCategoryBranch } from "@/modules/store/category-tree";
import type {CatalogQuery} from "@/modules/store/catalog-query";
import {selectedBrands,selectedAttributes,maxAttributeValues,listingRangeLabel,activeFilters,availabilityLabels,isPanelFilter,clearPanelFilters,toggleAttribute,toggleBrand,type CatalogFacet,type FilterUpdate} from "@/modules/store/catalog-filters";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { StoreCheckbox } from "@/components/site/store-checkbox";
import { useCategoryTree } from "@/components/navigation/use-category-tree";
import { storeDialogOverlay } from "@/components/store-dialog-classes";
// Make, model and category live in the path (/kategori/{category}/{make}, /yedek-parca/{make}/{model}), every other
// filter in the query string.
import {listingPath,listingUrl} from "@/modules/seo/paths";
import {ComparisonProvider} from "./catalog-card-controls";

type Query=CatalogQuery;
const searchBox="flex h-10 items-center gap-2 rounded-md border border-input bg-white px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50";
const searchInput="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted-foreground";
// Children of the active category (or the top level) from the server, with a search across the whole tree,
// which loads from /api/categories when the search box gets focus (#642).
// `listed`: on a make or model listing, the categories holding its products; the search offers only those (#673).
function SidebarCategoryTree({nodes,selected,href,listed}:{nodes:SidebarCategoryBranch["nodes"];selected?:string;href:(slug:string)=>string;listed?:number[]}){
 const [search,setSearch]=useState("");
 const tree=useCategoryTree();
 const categories=tree.categories??[];
 const term=search.trim().toLocaleLowerCase("tr");
 const matches=searchCategories(categories,term,listed);
 const item="flex min-h-[30px] items-center justify-between py-[5px] pr-[35px] pl-[25px] text-sm leading-5 font-medium text-foreground transition-colors hover:text-brand aria-[current=page]:bg-[#f8f9f9] aria-[current=page]:text-foreground";
 return <div>
  <label className={cn(searchBox,"mx-[25px] mb-[15px]")}><Search size={16} aria-hidden="true" className="shrink-0"/><input type="search" className={searchInput} aria-label="Kategori ara" placeholder="Kategori ara" value={search} onFocus={tree.load} onChange={e=>{setSearch(e.target.value);tree.load();}}/></label>
  {term&&!tree.categories?(tree.error?<div role="alert" className="flex flex-col items-start gap-3 px-[25px] text-sm leading-[22px] text-muted-foreground"><p>Kategoriler yüklenemedi.</p><Button type="button" variant="outline" className="min-h-11 px-4 text-sm" onClick={tree.retry}>Tekrar dene</Button></div>:<p role="status" aria-busy="true" className="px-[25px] text-sm leading-[22px] text-muted-foreground">Kategoriler yükleniyor…</p>)
  :term?<ul>{matches.map(c=><li key={c.id}><Link className={cn(item,"block")} href={href(c.slug)} aria-current={c.slug===selected?"page":undefined}>{c.name}<small className="mt-[3px] block text-[11px] leading-normal font-normal text-muted-foreground">{categoryPath(categories,c.id).slice(0,-1).map(n=>n.name).join(" / ")}</small></Link></li>)}{!matches.length&&<li className="px-[25px] text-sm leading-[22px] text-muted-foreground">Kategori bulunamadı.</li>}</ul>
  :<ul>{nodes.map(c=><li key={c.id}><Link className={item} href={href(c.slug)} aria-current={c.slug===selected?"page":undefined}><span>{c.name}</span>{c.hasChildren&&<ChevronRight size={14} aria-hidden="true"/>}</Link></li>)}</ul>}
 </div>;
}
// Long option lists (182 makers) render their first entries until opened or searched: each checkbox
// is ~1 kB of markup, and the box only shows about ten at a time anyway.
const collapsedOptions=12;
function FilterGroup({label,options,selected,onToggle,searchable=true,isBlocked,hint,defaultOpen=true}:{defaultOpen?:boolean;label:string;options:{value:string;label:string}[];selected:string[];onToggle:(value:string)=>void;searchable?:boolean;isBlocked?:(value:string)=>boolean;hint?:string}){
 const [search,setSearch]=useState("");
 const [showAll,setShowAll]=useState(false);
 // Controlled from its first value: the sheet's default (open when something is selected) changes with every tick.
 const [open,setOpen]=useState(defaultOpen);
 const matching=options.filter(o=>o.label.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")));
 const visible=search||showAll?matching:matching.filter((option,index)=>index<collapsedOptions||selected.includes(option.value));
 return <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border last:border-b-0">
 <CollapsibleTrigger className="group/facet flex min-h-[50px] w-full cursor-pointer rounded-none border-0 bg-transparent text-foreground items-center justify-between px-[25px] py-[15px] max-[768px]:px-5 text-left text-base leading-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"><strong className="font-bold">{label}</strong><span aria-hidden="true" className="text-xl font-medium group-data-panel-open/facet:hidden">+</span><span aria-hidden="true" className="hidden text-xl font-medium group-data-panel-open/facet:inline">−</span></CollapsibleTrigger>
 <CollapsibleContent>
 {searchable&&<label className="relative mx-[25px] mb-[15px] block pt-[5px]"><Image className="absolute top-[15px] left-2.5 max-[768px]:top-[17px]" src="/media/site/icons/search.svg" width={20} height={20} alt="" unoptimized/><input type="search" className="h-10 w-full max-[768px]:h-11 rounded-md border border-input bg-white py-2 pr-2.5 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={label+" ara"} placeholder="Ara" value={search} onChange={e=>setSearch(e.target.value)}/></label>}
 {/* Phones: the first entries without an inner scroll (the panel scrolls); a searched or opened long list scrolls in its own box. */}
 <div className={cn("max-h-[300px] overflow-auto px-[25px] pt-[5px] pb-[25px] max-[768px]:px-5 max-[768px]:pb-4",search||showAll?"max-[768px]:max-h-80 max-[768px]:overscroll-contain":"max-[768px]:max-h-none max-[768px]:overflow-visible")}>{visible.map(option=><label key={option.value} className="facet-option">
  <StoreCheckbox checked={selected.includes(option.value)} disabled={!selected.includes(option.value)&&(isBlocked?isBlocked(option.value):selected.length>=30)} onChange={()=>onToggle(option.value)}/><span>{option.label}</span></label>)}
  {visible.length<matching.length&&<button type="button" className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-brand-strong hover:underline max-[768px]:min-h-11" onClick={()=>setShowAll(true)}>Tümünü göster ({matching.length.toLocaleString("tr-TR")})</button>}</div>
 {hint&&<p className="px-[25px] pb-[15px] text-[13px] text-muted-foreground">{hint}</p>}
 {!options.length&&<p className="px-[25px] pb-[25px] text-[13px] text-muted-foreground">Bu kategoride kayıt bulunamadı.</p>}
 </CollapsibleContent>
 </Collapsible>;
}
// One listing whatever the order of its query string, to tell whether the shown listing is the one a tick asked for.
function listingKey(query:Query){const url=new URL(listingUrl(query),"https://getirbakim.invalid");url.searchParams.sort();return url.pathname+url.search;}
type FilterProps={brands:string[];facets:CatalogFacet[];params:Query};
// Manufacturers, the facets and the stock state: the desktop sidebar's lower box and the phone filter panel's body.
// `panel`: in the phone sheet only the manufacturers and the groups with a selection start open, so the groups fit on
// one screen; the desktop sidebar opens every group.
function CatalogFilterGroups({brands,facets,params,onChange,panel=false}:FilterProps&{onChange:(updates:FilterUpdate)=>void;panel?:boolean}){
 const selected=selectedBrands(params),attributes=selectedAttributes(params);
 // A product without a display brand (NULL or blank in the facet query) would be an unnamed box.
 return <>
  <FilterGroup label="Üretici" options={brands.filter(value=>Boolean(value?.trim())).map(value=>({value,label:value}))} selected={selected} onToggle={value=>onChange(toggleBrand(params,value))}/>
  {facets.map(facet=>{const current=attributes[facet.key]??[];return <FilterGroup key={facet.key} defaultOpen={!panel||current.length>0} searchable={facet.key!=="Brand class"} label={facet.label} options={facet.options.map(o=>({value:o.values[0],label:o.label}))} selected={facet.options.filter(o=>o.values.some(v=>current.includes(v))).map(o=>o.values[0])} isBlocked={value=>current.length+(facet.options.find(o=>o.values[0]===value)?.values.filter(v=>!current.includes(v)).length??0)>maxAttributeValues} hint={facet.options.some(o=>!o.values.some(v=>current.includes(v))&&current.length+o.values.filter(v=>!current.includes(v)).length>maxAttributeValues)?`En fazla ${maxAttributeValues} seçim yapılabilir.`:undefined} onToggle={value=>{const option=facet.options.find(o=>o.values[0]===value);if(option)onChange(toggleAttribute(params,facet.key,option.values));}}/>;})}
  <FilterGroup label="Stok durumu" defaultOpen={!panel||Boolean(params.availability)} searchable={false} options={Object.entries(availabilityLabels).map(([value,label])=>({value,label}))} selected={params.availability?[params.availability]:[]} onToggle={value=>onChange({availability:params.availability===value?undefined:value as keyof typeof availabilityLabels})}/>
 </>;
}
// `branch` null: no category links (manufacturer pages, #660). `listed`: on a make or model listing, the categories
// holding its products (#673); every category elsewhere. A listing with no category to offer (no branch nodes, nothing
// listed) shows no category block.
// Desktop only: phones (≤768px) filter in CatalogFilterSheet. The server still renders it there, hidden, so the category
// links stay in the HTML (#755).
export function CatalogSidebar({branch,listed,brands,facets,params}:FilterProps&{branch:SidebarCategoryBranch|null;listed?:number[]}) {
 const router=useRouter();
 const parent=branch?.parent;
 // Desktop: stays pinned under the compact header (88px) + finder bar (80px) and scrolls on its own when taller than the
 // viewport (#805). Padding/negative margin keep focus rings from being clipped by the scroll container.
 return <aside className="sticky top-[184px] -mx-1 max-h-[calc(100dvh-200px)] min-w-0 overflow-y-auto overscroll-contain p-1 max-[768px]:hidden">
 {branch&&(branch.nodes.length>0||listed?.length!==0)&&<section className="mb-[15px] rounded-[4px] border border-border bg-white py-[25px]"><h2 className="mb-[15px] flex items-center gap-2.5 px-[25px] text-base leading-6 font-semibold"><Link className="grid size-6 place-items-center rounded-[3px] bg-[#f1f3f5] hover:bg-[#e6e9ec]" aria-label="Üst kategori" href={parent?listingUrl(params,{category:parent.slug,attributes:undefined,brands:undefined,brand:undefined,oil:undefined}):listingPath({makeSlug:params.make,modelSlug:params.model})}><ChevronLeft size={16}/></Link>{parent?.name??"Kategoriler"}</h2><nav aria-label="Katalog kategorileri"><SidebarCategoryTree nodes={branch.nodes} listed={listed} selected={params.category} href={slug=>listingUrl(params,{category:slug,brand:undefined,brands:undefined,attributes:undefined,availability:undefined,oil:undefined})}/></nav></section>}
 <div className="overflow-hidden rounded-[4px] border border-border bg-white"><CatalogFilterGroups brands={brands} facets={facets} params={params} onChange={updates=>router.push(listingUrl(params,updates),{scroll:false})}/></div>
 </aside>;
}
// Phones (≤768px): "Filtrele" opens the filter groups in a bottom sheet. Every tick navigates at once (the URL stays the
// filter state, #883) and the sheet stays open: the server's new count fills "N ürünü göster", which only closes it.
// `chipFacets`: the facets with the selected values they no longer offer (withSelectedOptions), for the chips only.
export function CatalogFilterSheet({brands,facets,chipFacets,params,count,vehicleName}:FilterProps&{chipFacets:CatalogFacet[];count:number;vehicleName?:string}){
 const router=useRouter();
 const [open,setOpen]=useState(false);
 // The query the last tick asked for. Every server response (the asked one, an earlier one or a Back) ends it, and it
 // only counts while it differs from the listing shown, so "Güncelleniyor…" cannot outlive the navigation. Ticks build
 // on it, so quick successive ticks (and "Temizle") never act on a stale query.
 const [draft,setDraft]=useState<Query|null>(null);
 const [shown,setShown]=useState(params);
 if(shown!==params){setShown(params);setDraft(null);}
 const pending=draft!==null&&listingKey(draft)!==listingKey(params);
 const query=pending?draft:params;
 const chips=activeFilters(query,chipFacets,{vehicleName});
 const panelSelected=chips.some(isPanelFilter);
 // The first change after opening pushes a history entry and the rest replace it: Back returns to the listing as it was
 // before the sheet, one step however many boxes were tried. The chips above the results and the desktop sidebar push:
 // each is one deliberate change that Back undoes. Back or Forward while the sheet is open moves off that entry, so the
// next change pushes again instead of overwriting the entry Back landed on.
 const pushed=useRef(false);
 useEffect(()=>{
  if(!open)return;
  const moved=()=>{pushed.current=false;};
  window.addEventListener("popstate",moved);
  return()=>window.removeEventListener("popstate",moved);
 },[open]);
 function change(updates:FilterUpdate){
  const next={...query,...updates,page:undefined};
  setDraft(next);
  if(pushed.current)router.replace(listingUrl(next),{scroll:false});
  else{pushed.current=true;router.push(listingUrl(next),{scroll:false});}
 }
 function openChange(next:boolean){setOpen(next);if(next)pushed.current=false;else setDraft(null);}
 const plain="h-auto min-h-11 rounded-md text-sm font-medium";
 const primary="border-brand bg-brand text-white hover:bg-brand-strong",secondary="border-input bg-white text-foreground";
 const empty=count===0&&!pending;
 return <Sheet open={open} onOpenChange={openChange}>
  <SheetTrigger render={<Button type="button" variant="outline" className={cn(plain,secondary,"w-full gap-2 px-3")}/>}><SlidersHorizontal size={17} aria-hidden="true"/>Filtrele{chips.length>0&&<span className="tabular-nums">({chips.length})</span>}</SheetTrigger>
  <SheetContent side="bottom" showCloseButton={false} overlayClassName={storeDialogOverlay} className="max-h-[85dvh] gap-0 rounded-t-[14px] border-0 bg-white p-0 text-foreground">
   <div className="flex shrink-0 items-center justify-between border-b border-border py-1 pr-1.5 pl-5">
    <SheetTitle className="text-lg leading-6 font-semibold">Filtreler</SheetTitle>
    <SheetClose aria-label="Filtreleri kapat" render={<Button type="button" variant="ghost" className="size-11 min-h-11 rounded-md p-0 text-foreground"/>}><X size={20} aria-hidden="true"/></SheetClose>
   </div>
   <p className="sr-only" role="status" aria-live="polite" aria-busy={pending}>{pending?"Sonuçlar güncelleniyor":`${count.toLocaleString("tr-TR")} ürün bulundu`}</p>
   <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {chips.length>0&&<ul aria-label="Seçili filtreler" className="flex flex-wrap gap-2 border-b border-border px-5 py-3">{chips.map(chip=><li key={chip.key}><Button type="button" variant="outline" className={cn(plain,secondary,"max-w-full gap-1.5 rounded-full px-3 font-normal whitespace-normal")} onClick={()=>change(chip.remove)}><span className="text-left">{chip.label}<span className="sr-only"> filtresini kaldır</span></span><X size={14} aria-hidden="true"/></Button></li>)}</ul>}
    <CatalogFilterGroups panel brands={brands} facets={facets} params={query} onChange={change}/>
   </div>
   {/* No result: "Temizle" becomes the main action; the other button still closes the sheet. */}
   <div className="flex shrink-0 gap-3 border-t border-border bg-white px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
    <Button type="button" variant="outline" className={cn(plain,empty&&panelSelected?primary:secondary,"flex-1 px-4")} disabled={!panelSelected} onClick={()=>change(clearPanelFilters)}>Temizle</Button>
    <Button type="button" variant="outline" className={cn(plain,empty&&panelSelected?secondary:primary,"flex-2 px-4")} onClick={()=>openChange(false)}>{pending?"Güncelleniyor…":empty?"Sonuç yok — filtreleri değiştir":`${count.toLocaleString("tr-TR")} ürünü göster`}</Button>
   </div>
  </SheetContent>
 </Sheet>;
}
const pageButton="h-12 rounded-md border-brand bg-brand px-[27px] text-sm text-white hover:bg-brand-strong";
// `filters`: the phone filter button (CatalogFilterSheet), first in the toolbar's top row with the sort beside it; `active`:
// the selected filters as removable chips (CatalogActiveFilters), under the toolbar.
// `lead`: shown above the results' toolbar and chips, which belong to the results (the garage vehicle's fits and the
// "Tüm sonuçlar" heading, #884), inside the comparison provider so its cards' compare boxes work. Only the results take the list / grid switch (`group/listing`): the lead
// keeps its own grid, and a nested group would match the outer one's view too.
export function CatalogResults({count,page,pages,pageSize,params,children,defaultView="grid",filters,active,lead}:{count:number;page:number;pages:number;pageSize:number;params:Query;children:ReactNode;defaultView?:"list"|"grid";filters?:ReactNode;active?:ReactNode;lead?:ReactNode}) {
 const [view,setView]=useState(defaultView);const router=useRouter();
 // 44px touch targets on a phone (#878).
 const viewButton="h-7 min-h-7 w-[22px] rounded-none border-0 bg-transparent p-0 hover:bg-transparent [&>img]:opacity-20 aria-pressed:[&>img]:opacity-100 max-[768px]:size-11 max-[768px]:min-h-11";
 // Phones (≤768px): filter and sort share the top row, the range and the view buttons the second (the right-hand group
 // dissolves into the toolbar so its items can be ordered).
 const half="max-[768px]:order-1 max-[768px]:grow max-[768px]:basis-[calc(50%-6px)]";
 return <ComparisonProvider><div className="min-w-0">
 {lead}
 <div className="mb-[25px] flex min-h-[42px] items-center justify-between gap-4 max-[768px]:mb-4 max-[768px]:flex-wrap max-[768px]:gap-3"><span className="text-sm leading-5 text-foreground max-[768px]:order-2 max-[768px]:flex-1 max-[600px]:text-xs">{listingRangeLabel(count,page,pageSize)}</span>
 <div className="flex items-center gap-[15px] max-[768px]:contents">
  <div className="flex h-[42px] items-center gap-3 rounded-md border border-input px-3 py-1 max-[768px]:order-2 max-[768px]:h-11 max-[768px]:gap-0 max-[768px]:p-0">
   <Button variant="ghost" className={viewButton} aria-label="Liste görünümü" aria-pressed={view==="list"} onClick={()=>setView("list")}><Image src="/media/site/icons/layout-list.svg" width={24} height={24} alt="" unoptimized/></Button>
   <Button variant="ghost" className={viewButton} aria-label="Izgara görünümü" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><Image src="/media/site/icons/layout-grid.svg" width={24} height={24} alt="" unoptimized/></Button>
  </div>
  {filters&&<div className={cn("min-[769px]:hidden",half)}>{filters}</div>}
  <NativeSelect name="sort" aria-label="Ürünleri sırala" value={params.sort ?? (params.q ? "relevance" : "newest")} onChange={event=>router.push(listingUrl(params,{sort:event.target.value as Query["sort"]}))}
   className={cn("w-[180px] max-[768px]:w-auto [&>select]:h-[42px] max-[768px]:[&>select]:h-11 [&>select]:rounded-md [&>select]:bg-white [&>select]:pr-[30px] [&>select]:pl-3 [&>select]:text-sm [&>svg]:text-foreground",half)}>
   {params.q&&<NativeSelectOption value="relevance">En alakalı</NativeSelectOption>}<NativeSelectOption value="newest">Son eklenenler</NativeSelectOption><NativeSelectOption value="price-asc">Fiyat: düşükten yükseğe</NativeSelectOption><NativeSelectOption value="price-desc">Fiyat: yüksekten düşüğe</NativeSelectOption>
  </NativeSelect>
 </div></div>
 {active}
 <div className="group/listing" data-view={view}><div className="flex flex-col gap-4 group-data-[view=grid]/listing:mx-[-2px] group-data-[view=grid]/listing:grid group-data-[view=grid]/listing:grid-cols-3 group-data-[view=grid]/listing:items-stretch group-data-[view=grid]/listing:gap-x-4 group-data-[view=grid]/listing:gap-y-6 max-[992px]:group-data-[view=grid]/listing:grid-cols-2 max-[600px]:group-data-[view=grid]/listing:mx-0 max-[600px]:group-data-[view=grid]/listing:gap-x-2 max-[600px]:group-data-[view=grid]/listing:gap-y-4">{children}</div></div>
 {pages>1 && <Pagination aria-label="Katalog sayfaları" className="mt-[25px]"><PaginationContent className="flex-wrap justify-center gap-4 text-sm">
  {page>1 && <PaginationItem><Button className={pageButton} nativeButton={false} render={<Link href={listingUrl(params,{page:String(page-1)})}/>}>Önceki sayfa</Button></PaginationItem>}
  <PaginationItem><span>Sayfa {page} / {pages}</span></PaginationItem>
  {page<pages && <PaginationItem><Button className={pageButton} nativeButton={false} render={<Link href={listingUrl(params,{page:String(page+1)})}/>}>Sonraki sayfa</Button></PaginationItem>}
 </PaginationContent></Pagination>}
 </div></ComparisonProvider>;
}
