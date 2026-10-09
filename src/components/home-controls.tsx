"use client";

import {Children, useEffect, useRef, useState, type ReactNode} from "react";
import {ChevronLeft, ChevronRight} from "lucide-react";
import {CategoryCards} from "./category-cards";
import type {StoreCategory} from "@/modules/store/category-tree";

function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

function Pager({page, pages, onChange, label}: {page:number; pages:number; onChange:(page:number)=>void; label:string}) {
  if (pages < 2) return null;
  return <>
    <button className="home-slider-arrow previous" aria-label={label+": önceki"} disabled={page===0} onClick={()=>onChange(page-1)}><ChevronLeft size={18}/></button>
    <button className="home-slider-arrow next" aria-label={label+": sonraki"} disabled={page===pages-1} onClick={()=>onChange(page+1)}><ChevronRight size={18}/></button>
    <div className="home-slider-pagination" aria-label={label+" sayfaları"}>{Array.from({length:pages},(_,index)=><button key={index} type="button" aria-label={label+": "+(index+1)+". sayfa"} aria-current={page===index?"true":undefined} onClick={()=>onChange(index)}/>)}</div>
  </>;
}

export function HomeCarousel({children,label,kind="promotions",columns=5}:{children:ReactNode;label:string;kind?:"promotions"|"products";columns?:number}) {
  const slides = Children.toArray(children);
  const mobile = useMobile();
  const perPage = kind==="products" ? (mobile?2:columns) : (mobile?1:2);
  const pages = Math.ceil(slides.length/perPage);
  const [selected,setSelected]=useState(0);
  const page=Math.min(selected,Math.max(0,pages-1));
  const start=Math.min(page*perPage,Math.max(0,slides.length-perPage));
  const touch=useRef(0);
  if (!slides.length) return null;
  return <div className={"home-slider home-slider-"+kind} role="region" aria-label={label} aria-roledescription="slider"
    onTouchStart={event=>{touch.current=event.changedTouches[0].clientX;}}
    onTouchEnd={event=>{const movement=touch.current-event.changedTouches[0].clientX;if(Math.abs(movement)>50)setSelected(Math.max(0,Math.min(pages-1,page+(movement>0?1:-1))));}}>
    <div className="home-slider-grid" style={{gridTemplateColumns:`repeat(${perPage},minmax(0,1fr))`}}>{slides.slice(start,start+perPage).map((slide,index)=><div key={start+index} className="home-slide">{slide}</div>)}</div>
    <Pager page={page} pages={pages} onChange={setSelected} label={label}/>
  </div>;
}

export function HomeGridPager({children,label,kind}:{children:ReactNode;label:string;kind:"makes"|"manufacturers"}) {
  const entries=Children.toArray(children),mobile=useMobile();
  const perPage=mobile?12:kind==="makes"?18:24;
  const pages=Math.ceil(entries.length/perPage);
  const [selected,setSelected]=useState(0);
  const page=Math.min(selected,Math.max(0,pages-1));
  return <div className={"home-slider home-grid-slider home-grid-"+kind} role="region" aria-label={label}>
    <div className="home-brand-grid">{entries.slice(page*perPage,(page+1)*perPage)}</div>
    <Pager page={page} pages={pages} onChange={setSelected} label={label}/>
  </div>;
}

export function HomeCategoryTabs({categories}:{categories:StoreCategory[]}) {
  const roots=categories.filter(category=>category.parentId===null);
  const [selected,setSelected]=useState(roots[0]?.id);
  const tabs=useRef<(HTMLButtonElement|null)[]>([]);
  return <section className="home-category-browser" aria-label="Ürün kategorileri">
    <div role="tablist" aria-label="Ana kategoriler" className="home-category-tabs">{roots.map((category,index)=><button key={category.id} ref={element=>{tabs.current[index]=element;}} type="button" role="tab" id={"home-category-tab-"+category.id} aria-controls="home-category-panel" aria-selected={selected===category.id} tabIndex={selected===category.id?0:-1} onClick={()=>setSelected(category.id)} onKeyDown={event=>{
      if(!["ArrowRight","ArrowLeft","Home","End"].includes(event.key))return;
      event.preventDefault();
      const next=event.key==="Home"?0:event.key==="End"?roots.length-1:(index+(event.key==="ArrowRight"?1:-1)+roots.length)%roots.length;
      setSelected(roots[next].id);tabs.current[next]?.focus();
    }}>{category.name}</button>)}</div>
    <div role="tabpanel" id="home-category-panel" aria-labelledby={"home-category-tab-"+selected}><CategoryCards categories={categories.filter(category=>category.parentId===selected)}/></div>
  </section>;
}

export function HomeScrollHeader() {
  useEffect(()=>{
    const update=()=>{if(window.scrollY>173)document.body.dataset.homeScrolled="true";else delete document.body.dataset.homeScrolled;};
    update();window.addEventListener("scroll",update,{passive:true});
    return()=>{window.removeEventListener("scroll",update);delete document.body.dataset.homeScrolled;};
  },[]);
  return null;
}
