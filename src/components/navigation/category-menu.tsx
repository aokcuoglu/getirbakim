"use client";
import Link from "next/link";
import Image from "next/image";
import {categoryPath,type StoreCategory} from "@/modules/store/category-tree";
import {useRef,useState,useEffect,type CSSProperties} from "react";
import {Menu,ChevronRight,ArrowLeft,X,UserRound,Info,Mail,Package} from "lucide-react";
const headerCategoryIds=[3,607,956,967,1023,11058];
export function CategoryMenu({categories}:{categories:StoreCategory[]}) {
 const [open,setOpen]=useState(false);
 const [selected,setSelected]=useState<number|null>(null);
 const [desktop,setDesktop]=useState<{rootId:number;selectedId:number;top:number}|null>(null);
 const desktopOpen=desktop!==null;
 const menu=useRef<HTMLDivElement>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const list=useRef<HTMLElement>(null);
 const trigger=useRef<HTMLButtonElement|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const current=categories.find(c=>c.id===selected);
 const children=selected===null?[...categories.filter(c=>c.parentId===3),...categories.filter(c=>c.parentId===null&&c.id!==3)]:categories.filter(c=>c.parentId===selected);
 const path=selected===null?[]:categoryPath(categories,selected);
 const headerCategories=headerCategoryIds.flatMap(id=>categories.filter(c=>c.id===id));
 const desktopRoot=categories.find(c=>c.id===desktop?.rootId);
 const desktopCurrent=categories.find(c=>c.id===desktop?.selectedId);
 const desktopBranches=categories.filter(c=>c.parentId===desktopRoot?.id);
 const desktopChildren=categories.filter(c=>c.parentId===desktopCurrent?.id);
 useEffect(()=>{
  if(!open&&!desktopOpen)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow="hidden";
  return()=>{document.body.style.overflow=previous;};
 },[open,desktopOpen]);
 useEffect(()=>{
  if(!desktopOpen)return;
  function dismiss(event:Event){
   if(event.target instanceof Element&&!menu.current?.contains(event.target)&&!event.target.closest('[data-category-trigger]'))setDesktop(null);
  }
  function escape(event:KeyboardEvent){
   if(event.key==="Escape"){setDesktop(null);trigger.current?.focus();}
  }
  function resize(){
   if(!window.matchMedia('(min-width:769px)').matches){setDesktop(null);return;}
   const top=menu.current?.closest('.category-nav')?.getBoundingClientRect().bottom;
   if(top!==undefined)setDesktop(previous=>previous?{...previous,top}:null);
  }
  document.addEventListener('pointerdown',dismiss);
  document.addEventListener('focusin',dismiss);
  document.addEventListener('keydown',escape);
  window.addEventListener('resize',resize);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('focusin',dismiss);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);};
 },[desktopOpen]);
 function close(){dialog.current?.close();setOpen(false);setDesktop(null);trigger.current?.focus();}
 function show(rootId:number,button:HTMLButtonElement,all=false){
  trigger.current=button;
  if(window.matchMedia('(min-width:769px)').matches){
   if(desktop?.rootId===rootId){setDesktop(null);return;}
   const firstBranch=categories.find(c=>c.parentId===rootId);
   const top=menu.current?.closest('.category-nav')?.getBoundingClientRect().bottom??0;
   setDesktop({rootId,selectedId:rootId===3&&firstBranch?firstBranch.id:rootId,top});
  }else{
   setSelected(all?null:rootId);
   dialog.current?.showModal();
   setOpen(true);
  }
 }
 function selectDesktop(id:number){setDesktop(previous=>previous?{...previous,selectedId:id}:null);}
 function drill(id:number|null){setSelected(id);list.current?.scrollTo(0,0);heading.current?.focus();}
 function row(category:StoreCategory){
  const hasChildren=categories.some(c=>c.parentId===category.id);
  const content=<>{category.imagePath?<Image src={category.imagePath} width={45} height={30} alt="" unoptimized/>:<Package className="category-placeholder" size={30}/>}<span>{category.name}</span>{hasChildren&&<ChevronRight size={14}/>}</>;
  const cls="category-drill-row"+(selected===null&&category.parentId===null?" category-root-row":"");
  return hasChildren?<button className={cls} key={category.id} type="button" onClick={()=>drill(category.id)}>{content}</button>:<Link className={cls} href={"/katalog?category="+category.slug} key={category.id} onClick={close}>{content}</Link>;
 }
 return <><div ref={menu} className="category-menu">
  <button data-category-trigger type="button" className="all-categories" aria-label="Tüm kategoriler" aria-expanded={open||desktop!==null} aria-controls={open?"category-sheet":"desktop-category-panel"} onClick={event=>show(3,event.currentTarget,true)}><Menu size={18}/><span>Katalog</span></button>
  {desktop&&desktopRoot&&desktopCurrent&&<>
   <div className="category-mega-backdrop" aria-hidden="true" style={{top:desktop.top}} onClick={close}/>
   <div className="category-mega" id="desktop-category-panel" style={{'--category-menu-top':desktop.top+'px'} as CSSProperties}>
    <nav className="category-mega-sidebar" aria-label={desktopRoot.name+" kategorileri"}>
     {desktopRoot.id!==3&&<button className="category-mega-overview" type="button" aria-current={desktopCurrent.id===desktopRoot.id?"true":undefined} onClick={()=>selectDesktop(desktopRoot.id)} onFocus={()=>selectDesktop(desktopRoot.id)}><ArrowLeft size={14}/><span>{desktopRoot.name}</span></button>}
     {desktopBranches.map(category=>{
      const hasChildren=categories.some(c=>c.parentId===category.id);
      const content=<>{category.imagePath?<Image src={category.imagePath} width={45} height={30} alt="" unoptimized/>:<Package className="category-placeholder" size={30} aria-hidden="true"/>}<span>{category.name}</span>{hasChildren&&<ChevronRight size={14} aria-hidden="true"/>}</>;
      return hasChildren?<button className="category-mega-branch" key={category.id} type="button" aria-current={category.id===desktop.selectedId?"true":undefined} aria-controls="category-mega-items" onMouseEnter={()=>selectDesktop(category.id)} onFocus={()=>selectDesktop(category.id)} onClick={()=>selectDesktop(category.id)}>{content}</button>:<Link className="category-mega-branch" key={category.id} href={"/katalog?category="+category.slug} prefetch={false} onClick={close}>{content}</Link>;
     })}
     <Link className="category-mega-all" href={"/katalog?category="+desktopRoot.slug} prefetch={false} onClick={close}>Tüm {desktopRoot.name.toLocaleLowerCase('tr')} <ChevronRight size={14}/></Link>
    </nav>
    <div className="category-mega-content">
     <button className="category-mega-close" type="button" aria-label="Kategorileri kapat" onClick={close}><X size={18}/></button>
     <nav className="category-mega-grid" id="category-mega-items" aria-label={desktopCurrent.name+" alt kategorileri"}>
      {desktopChildren.map(category=><Link className="category-mega-card" key={category.id} href={"/katalog?category="+category.slug} prefetch={false} onClick={close}>
       {category.imagePath?<Image src={category.imagePath} width={135} height={90} alt="" unoptimized/>:<span className="category-mega-placeholder"><Package size={42} aria-hidden="true"/></span>}<span>{category.name}</span>
      </Link>)}
     </nav>
     {desktopCurrent.id!==desktopRoot.id&&<Link className="category-mega-browse" href={"/katalog?category="+desktopCurrent.slug} prefetch={false} onClick={close}>{desktopCurrent.name}: tüm ürünler <ChevronRight size={14}/></Link>}
    </div>
   </div>
  </>}
  <dialog ref={dialog} className="category-sheet" id="category-sheet" aria-labelledby="category-sheet-title" onClose={()=>{setOpen(false);trigger.current?.focus();}} onClick={e=>{
   if(e.target!==dialog.current)return;
   const rect=dialog.current.getBoundingClientRect();
   if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)close();
  }}>
   <div className="category-sheet-heading">
    {selected!==null&&<button className="category-sheet-back" type="button" aria-label="Üst kategoriye dön" onClick={()=>drill(current?.parentId===3?null:current?.parentId??null)}><ArrowLeft size={20}/></button>}
    <button type="button" className="category-sheet-close" aria-label="Kategorileri kapat" onClick={close}><X size={18}/></button>
    <h2 ref={heading} tabIndex={-1} id="category-sheet-title">{current?.name??"Kategoriler"}</h2><span>🇹🇷 Türkiye <span>TRY ₺</span></span>
   </div>
   <nav ref={list} className="category-sheet-list" aria-label="Ürün kategorileri">
    {path.length>0&&<div className="category-sheet-path">{path.map(node=><button key={node.id} type="button" onClick={()=>drill(node.id)}>{node.name}</button>)}</div>}
    {current&&<Link className="category-browse-all" href={"/katalog?category="+current.slug} onClick={close}>{current.name}: tüm ürünler <ChevronRight size={14}/></Link>}
    {children.map(row)}
    {selected===null&&<Link className="category-sheet-all" href="/katalog" onClick={close}><Menu size={18}/><span>Tüm ürünler</span><ChevronRight size={14}/></Link>}
   </nav>
   <nav className="category-sheet-footer" aria-label="Hesap ve bilgi"><Link href="/giris" onClick={close}><UserRound size={15}/><span>Giriş yap</span></Link><Link href="/bilgi/hakkimizda" onClick={close}><Info size={15}/><span>Bilgi</span><ChevronRight size={14}/></Link><Link href="/iletisim" onClick={close}><Mail size={15}/><span>İletişim</span></Link></nav>
  </dialog>
 </div>{headerCategories.map(category=>categories.some(c=>c.parentId===category.id)?<button data-category-trigger className="category-nav-trigger" key={category.id} type="button" aria-expanded={desktop?.rootId===category.id||(open&&path.some(c=>c.id===category.id))} aria-controls={open?"category-sheet":"desktop-category-panel"} onClick={event=>show(category.id,event.currentTarget)}>{category.name}</button>:<Link key={category.id} href={"/katalog?category="+category.slug}>{category.name}</Link>)}</>;
}
