"use client";
import Link from "next/link";
import {useRef,type ReactNode,type RefObject} from "react";
import {Dialog as SheetPrimitive} from "@base-ui/react/dialog";
import {Menu,ChevronRight,ArrowLeft,X,Info,Mail,Package} from "lucide-react";
import {Sheet,SheetClose,SheetTitle} from "@/components/ui/sheet";
import {DialogOverlay as SheetOverlay,DialogPortal as SheetPortal} from "@/components/ui/dialog";
import {categoryPath,type CategoryLink,type StoreCategory} from "@/modules/store/category-tree";
import {cn} from "@/lib/utils";
import {Button} from "@/components/ui/button";
import {storeButton} from "@/components/store-button";
import {catalogPath,categoryPath as categoryHref} from "@/modules/seo/paths";
import {CategoryThumb,TreeStatus,reset,sheetRow} from "./category-parts";
import type {useCategoryTree} from "./use-category-tree";

const sheetIconButton=cn(reset,"absolute top-2.5 grid size-11 min-h-11 place-items-center rounded-[3px] bg-white/14 text-white hover:bg-white/27");

/**
 * The phone/tablet category sheet (below 769px), loaded with the first tap on a category trigger (#1017); the desktop mega
 * menu in category-menu.tsx never downloads it. `selected` (null: the catalog root) lives in the menu, which also sets aria-expanded.
 * `account` is the server-rendered account row (sheet-account.tsx, #1043); a click on any footer link closes the sheet.
 */
export function CategorySheet({open,onOpenChange,trigger,tree,links,account,selected,onSelect,onClose}:{
 open:boolean;
 onOpenChange:(open:boolean)=>void;
 trigger:RefObject<HTMLButtonElement|null>;
 tree:ReturnType<typeof useCategoryTree>;
 links:CategoryLink[];
 account:ReactNode;
 selected:number|null;
 onSelect:(id:number|null)=>void;
 onClose:()=>void;
}){
 const list=useRef<HTMLElement>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const categories=tree.categories??[];
 const current=categories.find(c=>c.id===selected);
 // Opened from a bar link before the tree arrived: its name and "tüm ürünler" link are already known.
 const currentLink=current??links.find(link=>link.id===selected);
 const children=selected===null?[...categories.filter(c=>c.parentId===3),...categories.filter(c=>c.parentId===null&&c.id!==3)]:categories.filter(c=>c.parentId===selected);
 const path=selected===null?[]:categoryPath(categories,selected);
 function drill(id:number|null){onSelect(id);list.current?.scrollTo(0,0);heading.current?.focus();}
 function row(category:StoreCategory){
  const hasChildren=categories.some(c=>c.parentId===category.id);
  const content=<><CategoryThumb category={category}/><span>{category.name}</span>{hasChildren&&<ChevronRight size={14}/>}</>;
  const cls=cn(reset,sheetRow,"min-h-[45px] bg-white px-4 py-[7px] text-sm leading-5 font-semibold",selected===null&&category.parentId===null&&"border-t border-border");
  return hasChildren?<button className={cls} key={category.id} type="button" onClick={()=>drill(category.id)}>{content}</button>:<Link className={cls} href={categoryHref(category.slug)} key={category.id} onClick={onClose}>{content}</Link>;
 }
 return <Sheet open={open} onOpenChange={onOpenChange}>
  <SheetPortal>
   <SheetOverlay className="bg-foreground/50 supports-backdrop-filter:backdrop-blur-none"/>
   <SheetPrimitive.Popup id="category-sheet" finalFocus={trigger}
    className="fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh w-[360px] max-w-[100vw] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] overflow-hidden bg-white text-sm leading-5 whitespace-normal text-foreground shadow-[0_6px_24px_rgba(33,43,54,.1)] outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none">
    <div className="relative flex h-[105px] shrink-0 flex-row items-center gap-3 bg-foreground bg-[url('/media/site/images/mobile-catalog.webp')] bg-cover bg-center px-4 pt-16 pb-4 text-white">
     {selected!==null&&tree.categories&&<button className={cn(sheetIconButton,"left-4")} type="button" aria-label="Üst kategoriye dön" onClick={()=>drill(current?.parentId===3?null:current?.parentId??null)}><ArrowLeft size={20}/></button>}
     <SheetClose className={cn(sheetIconButton,"right-4")} aria-label="Kategorileri kapat"><X size={18}/></SheetClose>
     <SheetTitle ref={heading} tabIndex={-1} className="m-0 line-clamp-2 min-w-0 flex-1 text-lg leading-6 font-semibold text-white outline-none max-[600px]:text-base">{currentLink?.name??"Kategoriler"}</SheetTitle>
     <span className="flex shrink-0 gap-2 text-[11px] text-white max-[600px]:text-[10px]">🇹🇷 Türkiye <span>TRY ₺</span></span>
    </div>
    <nav ref={list} className="min-h-0 flex-1 overflow-auto overscroll-contain" aria-label="Ürün kategorileri">
     {path.length>0&&<div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">{path.map(node=><Button key={node.id} type="button" variant="outline" onClick={()=>drill(node.id)} className={cn(storeButton({intent:"outline",size:"md"}),"max-w-full whitespace-normal text-left")}>{node.name}</Button>)}</div>}
     {currentLink&&<Link className={cn(sheetRow,"min-h-11 px-4 py-2 text-sm font-medium text-brand")} href={categoryHref(currentLink.slug)} onClick={onClose}>{currentLink.name}: tüm ürünler <ChevronRight size={14}/></Link>}
     {tree.categories?(selected!==null&&!current?<TreeStatus error={false} missing retry={tree.retry} rows={0} rowClass=""/>:children.map(row)):<TreeStatus error={tree.error} retry={tree.retry} rows={10} rowClass="min-h-[45px] py-[7px]"/>}
     {selected===null&&<Link className={cn(sheetRow,"mt-3 min-h-[52px] border-t border-border px-3 py-2.5 text-sm font-medium")} href={catalogPath} onClick={onClose}><Menu size={18}/><span>Tüm ürünler</span><ChevronRight size={14}/></Link>}
    </nav>
    <nav className="shrink-0 border-t border-border" aria-label="Hesap ve bilgi" onClick={event=>{if(event.target instanceof Element&&event.target.closest("a"))onClose();}}>
     {account}
     {([["/bilgi/teslimat",Package,"Teslimat",false],["/bilgi/hakkimizda",Info,"Hakkımızda",false],["/bilgi/yardim",Info,"Yardım merkezi",false],["/iletisim",Mail,"İletişim",false]] as const).map(([href,Icon,label,more])=>
      <Link key={href} href={href} className={cn(sheetRow,"min-h-[49px] border-b border-border px-4 py-3 text-sm font-normal")}><Icon size={15}/><span>{label}</span>{more&&<ChevronRight size={14}/>}</Link>)}
    </nav>
   </SheetPrimitive.Popup>
  </SheetPortal>
 </Sheet>;
}
