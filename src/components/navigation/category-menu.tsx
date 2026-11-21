"use client";
import Link from "next/link";
import Image from "next/image";
import {categoryPath,type CategoryLink} from "@/modules/store/category-tree";
import {Skeleton} from "@/components/ui/skeleton";
import {useCategoryTree} from "./use-category-tree";
import {useRef,useState,useEffect,type ReactNode} from "react";
import {Menu,ChevronRight,ArrowLeft,X,Package} from "lucide-react";
import {cn} from "@/lib/utils";
import {lazyModule} from "@/lib/lazy-module";
import {categoryPath as categoryHref} from "@/modules/seo/paths";
import {CategoryThumb,TreeStatus,reset} from "./category-parts";

// Phones and tablets only: fetched on the first hover, focus or tap below 769px; the desktop never downloads it (#1017).
const categorySheet=lazyModule(()=>import("./category-sheet"));
const mobile=()=>!window.matchMedia('(min-width:769px)').matches;
const megaLink="flex min-h-9 items-center gap-1.5 px-4 pt-3 pb-0 text-xs font-medium text-brand hover:underline hover:underline-offset-3";
/**
 * The header category navigation: desktop mega menu (from 769px) and the phone/tablet category sheet.
 * The page sends only the bar's `links`; the tree comes from /api/categories on the first hover, focus or click (#642).
 * `account` is the sheet's server-rendered account row (#1043).
 */
export function CategoryMenu({links,account}:{links:CategoryLink[];account:ReactNode}) {
 const tree=useCategoryTree();
 const sheet=categorySheet.useModule();
 const categories=tree.categories??[];
 const [open,setOpen]=useState(false);
 const [selected,setSelected]=useState<number|null>(null);
 // `selectedId` null: the root's first branch for "Katalog", the root itself otherwise (known once the tree is here).
 const [desktop,setDesktop]=useState<{rootId:number;selectedId:number|null;top:number}|null>(null);
 const desktopOpen=desktop!==null;
 const menu=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement|null>(null);
 const path=selected===null?[]:categoryPath(categories,selected);
 const desktopRoot=categories.find(c=>c.id===desktop?.rootId);
 const firstBranch=desktopRoot?.id===3?categories.find(c=>c.parentId===3):undefined;
 const desktopSelectedId=desktop?.selectedId??firstBranch?.id??desktop?.rootId;
 const desktopCurrent=categories.find(c=>c.id===desktopSelectedId);
 const desktopBranches=categories.filter(c=>c.parentId===desktopRoot?.id);
 const desktopChildren=categories.filter(c=>c.parentId===desktopCurrent?.id);
 const navBottom=()=>menu.current?.parentElement?.getBoundingClientRect().bottom??0;
 useEffect(()=>{
  if(!desktopOpen)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow="hidden";
  function dismiss(event:Event){
   if(event.target instanceof Element&&!menu.current?.contains(event.target)&&!event.target.closest('[data-category-trigger]'))setDesktop(null);
  }
  function escape(event:KeyboardEvent){
   if(event.key==="Escape"){setDesktop(null);trigger.current?.focus();}
  }
  function resize(){
   if(!window.matchMedia('(min-width:769px)').matches){setDesktop(null);return;}
   const top=navBottom();
   setDesktop(previous=>previous?{...previous,top}:null);
  }
  document.addEventListener('pointerdown',dismiss);
  document.addEventListener('focusin',dismiss);
  document.addEventListener('keydown',escape);
  window.addEventListener('resize',resize);
  return()=>{document.body.style.overflow=previous;document.removeEventListener('pointerdown',dismiss);document.removeEventListener('focusin',dismiss);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);};
 },[desktopOpen]);
 function close(){setOpen(false);setDesktop(null);trigger.current?.focus();}
 function show(rootId:number,button:HTMLButtonElement,all=false){
  trigger.current=button;
  tree.load();
  if(window.matchMedia('(min-width:769px)').matches){
   if(desktop?.rootId===rootId){setDesktop(null);return;}
   setDesktop({rootId,selectedId:null,top:navBottom()});
  }else{
   setSelected(all?null:rootId);
   setOpen(true);
   categorySheet.preload().catch(()=>setOpen(false));
  }
 }
 // Hover/focus on a trigger: the tree for both layouts, the sheet's code only where the sheet is used.
 function intent(){tree.load();if(mobile())void categorySheet.preload();}
 function selectDesktop(id:number){setDesktop(previous=>previous?{...previous,selectedId:id}:null);}
 return <><div ref={menu} data-mega-open={desktopOpen?"":undefined} className="site-nav-all">
  <button data-category-trigger type="button" aria-label="Tüm kategoriler" aria-expanded={open||desktop!==null} aria-busy={open&&!sheet&&selected===null?true:undefined} aria-controls={open?"category-sheet":"desktop-category-panel"} onPointerEnter={intent} onFocus={intent} onClick={event=>show(3,event.currentTarget,true)}
   className="site-nav-catalog">
   <Menu size={18}/><span className="text-sm font-semibold max-[1100px]:hidden">Katalog</span>
  </button>
  {desktop&&<>
   <div className="fixed inset-x-0 bottom-0 z-1 bg-[#212b3680] max-[768px]:hidden" aria-hidden="true" style={{top:desktop.top}} onClick={close}/>
   <div id="desktop-category-panel" style={{top:desktop.top+1,maxHeight:`calc(100dvh - ${desktop.top}px - 16px)`}}
    className="fixed inset-x-[max(15px,calc((100vw-1320px)/2))] z-2 grid grid-cols-[minmax(240px,24%)_minmax(0,1fr)] overflow-hidden rounded-b-[4px] border border-t-0 border-border bg-white text-sm leading-5 font-normal whitespace-normal text-foreground shadow-[0_12px_24px_#0002] max-[850px]:grid-cols-[230px_minmax(0,1fr)] max-[768px]:hidden">
    {!desktopRoot||!desktopCurrent?(tree.error||tree.categories?<div className="relative col-span-2">
     <button type="button" aria-label="Kategorileri kapat" onClick={close} className={cn(reset,"absolute top-1 right-1 grid size-7 min-h-7 place-items-center rounded-[3px] bg-white text-muted-foreground hover:bg-[#f7f8fa] hover:text-foreground")}><X size={18}/></button>
     <TreeStatus error={tree.error} missing={Boolean(tree.categories)} retry={tree.retry} rows={0} rowClass=""/>
    </div>:<>
     <div className="border-r border-border py-6"><TreeStatus error={false} retry={tree.retry} rows={8} rowClass="min-h-10 py-[5px] pl-2"/></div>
     <div className="relative min-h-0 min-w-0 px-4 py-6">
      <button type="button" aria-label="Kategorileri kapat" onClick={close} className={cn(reset,"absolute top-1 right-1 grid size-7 min-h-7 place-items-center rounded-[3px] bg-white text-muted-foreground hover:bg-[#f7f8fa] hover:text-foreground")}><X size={18}/></button>
      <div aria-hidden="true" className="grid grid-cols-6 gap-x-2 gap-y-4 max-[1100px]:grid-cols-4 max-[850px]:grid-cols-3">{Array.from({length:12},(_,index)=><Skeleton key={index} className="h-[116px]"/>)}</div>
     </div>
    </>):<>
    <nav className="min-h-0 overflow-y-auto overscroll-contain border-r border-border py-6" aria-label={desktopRoot.name+" kategorileri"}>
     {desktopRoot.id!==3&&<button type="button" aria-current={desktopCurrent.id===desktopRoot.id?"true":undefined} onClick={()=>selectDesktop(desktopRoot.id)} onFocus={()=>selectDesktop(desktopRoot.id)}
      className={cn(reset,"flex min-h-9 w-full items-center justify-start gap-1.5 border-b border-border bg-white px-4 py-2 text-left text-xs text-brand hover:bg-[#f7f8fa] [&>svg]:shrink-0")}><ArrowLeft size={14}/><span>{desktopRoot.name}</span></button>}
     {desktopBranches.map(category=>{
      const hasChildren=categories.some(c=>c.parentId===category.id);
      const cls=cn(reset,"flex min-h-10 w-full items-center justify-start gap-2.5 bg-white py-[5px] pr-4 pl-2 text-left font-semibold text-foreground hover:bg-[#f8f9f9] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand aria-[current=true]:bg-[#f8f9f9] [&>svg:last-child]:ml-auto [&>svg:last-child]:shrink-0");
      const content=<><CategoryThumb category={category}/><span>{category.name}</span>{hasChildren&&<ChevronRight size={14} aria-hidden="true"/>}</>;
      return hasChildren?<button className={cls} key={category.id} type="button" aria-current={category.id===desktopCurrent.id?"true":undefined} aria-controls="category-mega-items" onMouseEnter={()=>selectDesktop(category.id)} onFocus={()=>selectDesktop(category.id)} onClick={()=>selectDesktop(category.id)}>{content}</button>:<Link className={cls} key={category.id} href={categoryHref(category.slug)} prefetch={false} onClick={close}>{content}</Link>;
     })}
     <Link className={megaLink} href={categoryHref(desktopRoot.slug)} prefetch={false} onClick={close}>Tüm {desktopRoot.name.toLocaleLowerCase('tr')} <ChevronRight size={14}/></Link>
    </nav>
    <div className="relative min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-6">
     <button type="button" aria-label="Kategorileri kapat" onClick={close} className={cn(reset,"absolute top-1 right-1 grid size-7 min-h-7 place-items-center rounded-[3px] bg-white text-muted-foreground hover:bg-[#f7f8fa] hover:text-foreground")}><X size={18}/></button>
     <nav className="grid grid-cols-6 items-start gap-x-2 gap-y-4 max-[1100px]:grid-cols-4 max-[850px]:grid-cols-3" id="category-mega-items" aria-label={desktopCurrent.name+" alt kategorileri"}>
      {desktopChildren.map(category=><Link key={category.id} href={categoryHref(category.slug)} prefetch={false} onClick={close}
       className="flex min-h-[116px] min-w-0 flex-col items-center gap-1.5 px-1 text-center font-semibold hover:text-brand hover:underline hover:underline-offset-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
       {category.imagePath?<Image src={category.imagePath} width={135} height={90} alt="" className="h-[90px] w-[135px] max-w-full object-contain"/>:<span className="grid h-[90px] w-[135px] max-w-full place-items-center text-[#9ca3af]"><Package size={42} aria-hidden="true"/></span>}<span>{category.name}</span>
      </Link>)}
     </nav>
     {desktopCurrent.id!==desktopRoot.id&&<Link className={megaLink} href={categoryHref(desktopCurrent.slug)} prefetch={false} onClick={close}>{desktopCurrent.name}: tüm ürünler <ChevronRight size={14}/></Link>}
    </div>
    </>}
   </div>
  </>}
  {sheet&&<sheet.CategorySheet open={open} onOpenChange={next=>{if(!next)setOpen(false);}} trigger={trigger} tree={tree} links={links} account={account} selected={selected} onSelect={setSelected} onClose={close}/>}
 </div>{links.map(category=>category.hasChildren
  ?<button data-category-trigger className="site-nav-trigger" key={category.id} type="button" aria-busy={open&&!sheet&&selected===category.id?true:undefined} aria-expanded={desktop?.rootId===category.id||(open&&(selected===category.id||path.some(c=>c.id===category.id)))} aria-controls={open?"category-sheet":"desktop-category-panel"} onPointerEnter={intent} onFocus={intent} onClick={event=>show(category.id,event.currentTarget)}>{category.name}</button>
  :<Link className="site-nav-item" key={category.id} href={categoryHref(category.slug)}>{category.name}</Link>)}</>;
}
