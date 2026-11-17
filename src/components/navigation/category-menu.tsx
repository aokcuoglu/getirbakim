"use client";
import Link from "next/link";
import Image from "next/image";
import {categoryPath,type CategoryLink,type StoreCategory} from "@/modules/store/category-tree";
import {Skeleton} from "@/components/ui/skeleton";
import {Button} from "@/components/ui/button";
import {useCategoryTree} from "./use-category-tree";
import {useRef,useState,useEffect} from "react";
import {Dialog as SheetPrimitive} from "@base-ui/react/dialog";
import {Menu,ChevronRight,ArrowLeft,X,UserRound,Info,Mail,Package} from "lucide-react";
import {Sheet,SheetClose,SheetTitle} from "@/components/ui/sheet";
import {DialogOverlay as SheetOverlay,DialogPortal as SheetPortal} from "@/components/ui/dialog";
import {cn} from "@/lib/utils";
import {catalogPath,categoryPath as categoryHref} from "@/modules/seo/paths";

const reset="min-h-0 rounded-none border-0 bg-transparent p-0 font-[inherit] text-inherit hover:bg-transparent";
const navItem="inline-flex min-h-5 shrink-0 items-center gap-1.5 text-[length:inherit] leading-[inherit] font-medium hover:text-brand aria-expanded:text-brand max-[600px]:min-h-11 max-[600px]:min-w-11 max-[600px]:justify-center";
const megaLink="flex min-h-9 items-center gap-1.5 px-4 pt-3 pb-0 text-xs font-medium text-brand hover:underline hover:underline-offset-3";
const sheetIconButton=cn(reset,"absolute top-2.5 grid size-11 min-h-11 place-items-center rounded-[3px] bg-white/14 text-white hover:bg-white/27");
const sheetRow="flex w-full items-center gap-3 text-left text-foreground hover:bg-[#f4f5f6] hover:text-brand [&>svg:last-child]:ml-auto [&>svg:last-child]:shrink-0";

/** The tree's error (with a retry when the request failed) or, while it loads, placeholder rows as tall as the real ones. */
function TreeStatus({error,missing,retry,rows,rowClass}:{error:boolean;missing?:boolean;retry:()=>void;rows:number;rowClass:string}){
 if(error||missing)return <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6 text-sm leading-5 text-foreground">
  <p>{missing?"Bu kategori bulunamadı.":"Kategoriler yüklenemedi."}</p>
  {error&&<Button type="button" variant="outline" onClick={retry} className="min-h-11 px-4 text-sm">Tekrar dene</Button>}
 </div>;
 return <div role="status" aria-busy="true"><span className="sr-only">Kategoriler yükleniyor…</span>{Array.from({length:rows},(_,index)=><div key={index} aria-hidden="true" className={cn("flex items-center gap-3 px-4",rowClass)}><Skeleton className="h-[30px] w-[45px] shrink-0"/><Skeleton className="h-4 flex-1"/></div>)}</div>;
}

/**
 * The header category navigation: desktop mega menu (from 769px) and the phone/tablet category sheet.
 * The page sends only the bar's `links`; the tree comes from /api/categories on the first hover, focus or click (#642).
 */
export function CategoryMenu({links}:{links:CategoryLink[]}) {
 const tree=useCategoryTree();
 const categories=tree.categories??[];
 const [open,setOpen]=useState(false);
 const [selected,setSelected]=useState<number|null>(null);
 // `selectedId` null: the root's first branch for "Katalog", the root itself otherwise (known once the tree is here).
 const [desktop,setDesktop]=useState<{rootId:number;selectedId:number|null;top:number}|null>(null);
 const desktopOpen=desktop!==null;
 const menu=useRef<HTMLDivElement>(null);
 const list=useRef<HTMLElement>(null);
 const trigger=useRef<HTMLButtonElement|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const current=categories.find(c=>c.id===selected);
 // Opened from a bar link before the tree arrived: its name and "tüm ürünler" link are already known.
 const currentLink=current??links.find(link=>link.id===selected);
 const children=selected===null?[...categories.filter(c=>c.parentId===3),...categories.filter(c=>c.parentId===null&&c.id!==3)]:categories.filter(c=>c.parentId===selected);
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
  }
 }
 function selectDesktop(id:number){setDesktop(previous=>previous?{...previous,selectedId:id}:null);}
 function drill(id:number|null){setSelected(id);list.current?.scrollTo(0,0);heading.current?.focus();}
 function thumb(category:StoreCategory){
  return category.imagePath?<Image src={category.imagePath} width={45} height={30} alt="" className="h-[30px] w-[45px] shrink-0 object-contain"/>:<Package className="w-[45px] shrink-0 text-[#9ca3af]" size={30} aria-hidden="true"/>;
 }
 function row(category:StoreCategory){
  const hasChildren=categories.some(c=>c.parentId===category.id);
  const content=<>{thumb(category)}<span>{category.name}</span>{hasChildren&&<ChevronRight size={14}/>}</>;
  const cls=cn(reset,sheetRow,"min-h-[45px] bg-white px-4 py-[7px] text-sm leading-5 font-semibold",selected===null&&category.parentId===null&&"border-t border-[#e5e7eb]");
  return hasChildren?<button className={cls} key={category.id} type="button" onClick={()=>drill(category.id)}>{content}</button>:<Link className={cls} href={categoryHref(category.slug)} key={category.id} onClick={close}>{content}</Link>;
 }
 return <><div ref={menu} data-mega-open={desktopOpen?"":undefined} className="w-[101px] shrink-0 border-r border-input max-[1100px]:w-[60px]">
  <button data-category-trigger type="button" aria-label="Tüm kategoriler" aria-expanded={open||desktop!==null} aria-controls={open?"category-sheet":"desktop-category-panel"} onPointerEnter={tree.load} onFocus={tree.load} onClick={event=>show(3,event.currentTarget,true)}
   className={cn(reset,"flex h-7 min-h-7 w-[76px] items-center justify-center gap-2 bg-white text-sm font-medium text-foreground hover:bg-[#f7f8fa] hover:text-brand max-[1100px]:w-11 max-[600px]:h-11 max-[600px]:min-h-11")}>
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
      const content=<>{thumb(category)}<span>{category.name}</span>{hasChildren&&<ChevronRight size={14} aria-hidden="true"/>}</>;
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
  <Sheet open={open} onOpenChange={next=>{if(!next)setOpen(false);}}>
   <SheetPortal>
    <SheetOverlay className="bg-[#22283180] supports-backdrop-filter:backdrop-blur-none"/>
    <SheetPrimitive.Popup id="category-sheet" finalFocus={trigger}
     className="fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh w-[360px] max-w-[100vw] flex-col overflow-hidden bg-white text-sm leading-5 whitespace-normal text-foreground shadow-[0_6px_24px_rgba(33,43,54,.1)] outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none">
     <div className="relative flex h-[105px] shrink-0 flex-row items-center gap-3 bg-[#222831] bg-[url('/media/site/images/mobile-catalog.webp')] bg-cover bg-center px-4 pt-16 pb-4 text-white">
      {selected!==null&&tree.categories&&<button className={cn(sheetIconButton,"left-4")} type="button" aria-label="Üst kategoriye dön" onClick={()=>drill(current?.parentId===3?null:current?.parentId??null)}><ArrowLeft size={20}/></button>}
      <SheetClose className={cn(sheetIconButton,"right-4")} aria-label="Kategorileri kapat"><X size={18}/></SheetClose>
      <SheetTitle ref={heading} tabIndex={-1} className="m-0 line-clamp-2 min-w-0 flex-1 text-lg leading-6 font-semibold text-white outline-none max-[600px]:text-base">{currentLink?.name??"Kategoriler"}</SheetTitle>
      <span className="flex shrink-0 gap-2 text-[11px] text-white max-[600px]:text-[10px]">🇹🇷 Türkiye <span>TRY ₺</span></span>
     </div>
     <nav ref={list} className="min-h-0 flex-1 overflow-auto overscroll-contain" aria-label="Ürün kategorileri">
      {path.length>0&&<div className="flex flex-wrap gap-1 px-4 pt-3 pb-1">{path.map(node=><button key={node.id} type="button" onClick={()=>drill(node.id)} className={cn(reset,"min-h-11 cursor-pointer rounded-[2px] bg-[#f0f1f2] px-3 py-1 text-xs leading-4 font-medium text-foreground hover:bg-[#e6e8ea]")}>{node.name}</button>)}</div>}
      {currentLink&&<Link className={cn(sheetRow,"min-h-11 px-4 py-2 text-xs font-medium text-brand")} href={categoryHref(currentLink.slug)} onClick={close}>{currentLink.name}: tüm ürünler <ChevronRight size={14}/></Link>}
      {tree.categories?(selected!==null&&!current?<TreeStatus error={false} missing retry={tree.retry} rows={0} rowClass=""/>:children.map(row)):<TreeStatus error={tree.error} retry={tree.retry} rows={10} rowClass="min-h-[45px] py-[7px]"/>}
      {selected===null&&<Link className={cn(sheetRow,"mt-3 min-h-[52px] border-t border-border px-3 py-2.5 text-sm font-medium")} href={catalogPath} onClick={close}><Menu size={18}/><span>Tüm ürünler</span><ChevronRight size={14}/></Link>}
     </nav>
     <nav className="shrink-0 border-t border-border" aria-label="Hesap ve bilgi">
      {([["/giris",UserRound,"Giriş yap",false],["/bilgi/hakkimizda",Info,"Bilgi",true],["/iletisim",Mail,"İletişim",false]] as const).map(([href,Icon,label,more])=>
       <Link key={href} href={href} onClick={close} className={cn(sheetRow,"min-h-[49px] border-b border-border px-4 py-3 text-sm font-normal")}><Icon size={15}/><span>{label}</span>{more&&<ChevronRight size={14}/>}</Link>)}
     </nav>
    </SheetPrimitive.Popup>
   </SheetPortal>
  </Sheet>
 </div>{links.map(category=>category.hasChildren
  ?<button data-category-trigger className={cn(reset,navItem)} key={category.id} type="button" aria-expanded={desktop?.rootId===category.id||(open&&(selected===category.id||path.some(c=>c.id===category.id)))} aria-controls={open?"category-sheet":"desktop-category-panel"} onPointerEnter={tree.load} onFocus={tree.load} onClick={event=>show(category.id,event.currentTarget)}>{category.name}</button>
  :<Link className={navItem} key={category.id} href={categoryHref(category.slug)}>{category.name}</Link>)}</>;
}
