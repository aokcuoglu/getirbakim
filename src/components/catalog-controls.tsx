"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, LayoutGrid, List, Search, SlidersHorizontal } from "lucide-react";
import { Select } from "@/components/ui/select";

type Query = {q?:string;category?:string;brand?:string;sort?:string;searchBy?:string;page?:string};
function catalogUrl(params:Query, updates:Partial<Query>) {
 const query=new URLSearchParams();
 Object.entries({...params,page:undefined,...updates}).forEach(([key,value])=>{if(value)query.set(key,value);});
 return `/katalog?${query}`;
}
export function CatalogSidebar({categories,brands,params}:{categories:{slug:string;name:string}[];brands:string[];params:Query}) {
 const filters=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const mobile=window.matchMedia("(max-width: 750px)");
  const update=()=>{if(filters.current)filters.current.open=!mobile.matches;};
  update();mobile.addEventListener("change",update);
  return()=>mobile.removeEventListener("change",update);
 },[]);
 const [categorySearch,setCategorySearch]=useState(""); const [brandSearch,setBrandSearch]=useState("");
 return <aside className="listing-sidebar"><details className="listing-filter-panel" ref={filters} open><summary><SlidersHorizontal size={17}/><span>Filtreler{params.category || params.brand ? " · Seçim uygulandı" : ""}</span><ChevronDown size={16}/></summary><div className="listing-filter-content"><details className="listing-category-panel" open><summary><ChevronLeft size={18}/><strong>Kategoriler</strong><ChevronDown size={16}/></summary><label className="listing-search"><Search size={18}/><input aria-label="Kategori ara" placeholder="Kategori ara" value={categorySearch} onChange={e=>setCategorySearch(e.target.value)}/></label><nav aria-label="Katalog kategorileri"><Link href={catalogUrl(params,{category:undefined,brand:undefined})} className={!params.category ? "selected" : ""}>Tüm ürünler</Link>{categories.filter(c=>c.name.toLocaleLowerCase("tr").includes(categorySearch.toLocaleLowerCase("tr"))).map(c=><Link key={c.slug} href={catalogUrl(params,{category:c.slug,brand:undefined})} className={params.category===c.slug ? "selected" : ""}>{c.name}</Link>)}</nav></details><details className="listing-brand-panel" open><summary><strong>Üretici</strong><ChevronDown size={16}/></summary><label className="listing-search"><Search size={18}/><input aria-label="Üretici ara" placeholder="Ara" value={brandSearch} onChange={e=>setBrandSearch(e.target.value)}/></label><div className="listing-brands">{brands.filter(b=>b.toLocaleLowerCase("tr").includes(brandSearch.toLocaleLowerCase("tr"))).map(b=><Link key={b} href={catalogUrl(params,{brand:params.brand===b ? undefined : b})} aria-current={params.brand===b ? "true" : undefined}><span className={`filter-check ${params.brand===b ? "checked" : ""}`} aria-hidden="true">{params.brand===b ? "✓" : ""}</span>{b}</Link>)}{!brands.length && <p>Bu kategoride henüz marka yok.</p>}</div>{params.brand && <Link className="listing-clear" href={catalogUrl(params,{brand:undefined})}>Marka filtresini temizle</Link>}</details><div className="listing-help"><strong>Doğru parçayı seç</strong><p>OEM kodu ve araç bilgileriyle uyumluluğu kontrol et.</p><Link href="/bilgi/uyumluluk">Uyumluluk rehberi →</Link></div></div></details></aside>;
}
export function CatalogResults({count,page,pages,pageSize,params,children,defaultView="grid"}:{count:number;page:number;pages:number;pageSize:number;params:Query;children:ReactNode;defaultView?:"list"|"grid"}) {
 const [view,setView]=useState(defaultView);const router=useRouter();
 return <div className={`listing-results ${view==="grid" ? "grid-view" : ""}`}><div className="listing-toolbar"><span>{count ? `${(page-1)*pageSize+1} – ${Math.min(page*pageSize,count)} / ${count.toLocaleString("tr-TR")} ürün` : "0 ürün"}</span><div className="listing-toolbar-controls"><div className="listing-view"><button type="button" aria-label="Liste görünümü" aria-pressed={view==="list"} onClick={()=>setView("list")}><List size={25}/></button><button type="button" aria-label="Izgara görünümü" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><LayoutGrid size={23}/></button></div><Select name="sort" label="Ürünleri sırala" value={params.sort ?? "newest"} options={[{value:"newest",label:"Son eklenenler"},{value:"price-asc",label:"Fiyat: düşükten yükseğe"},{value:"price-desc",label:"Fiyat: yüksekten düşüğe"}]} onChange={sort=>router.push(catalogUrl(params,{sort}))}/></div></div><div className="listing-items">{children}</div>{pages>1 && <nav className="catalog-pagination" aria-label="Katalog sayfaları">{page>1 && <Link className="button" href={catalogUrl(params,{page:String(page-1)})}>Önceki sayfa</Link>}<span>Sayfa {page} / {pages}</span>{page<pages && <Link className="button" href={catalogUrl(params,{page:String(page+1)})}>Sonraki sayfa</Link>}</nav>}</div>;
}
