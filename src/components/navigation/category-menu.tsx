"use client";
import Link from "next/link";
import Image from "next/image";
import { useRef,useState,useEffect } from "react";
import { Menu,ChevronRight,X,UserRound,Info,Mail } from "lucide-react";
export function CategoryMenu({categories}:{categories:{slug:string;name:string;image:string}[]}) {
 const [open,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow="hidden";
  return()=>{document.body.style.overflow=previous;};
 },[open]);
 function close(){dialog.current?.close();setOpen(false);trigger.current?.focus();}
 return <div className="category-menu"><button ref={trigger} type="button" className="all-categories" aria-label="Tüm kategoriler" aria-haspopup="dialog" aria-expanded={open} aria-controls="category-sheet" onClick={()=>{dialog.current?.showModal();setOpen(true);}}><Menu size={16}/></button><dialog ref={dialog} className="category-sheet" id="category-sheet" aria-labelledby="category-sheet-title" onClose={()=>{setOpen(false);trigger.current?.focus();}} onClick={e=>{
  if(e.target!==dialog.current)return;
  const rect=dialog.current.getBoundingClientRect();
  if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)close();
 }}><div className="category-sheet-heading"><button type="button" className="category-sheet-close" aria-label="Kategorileri kapat" onClick={close}><X size={16}/></button><h2 id="category-sheet-title">Kategoriler</h2><span>🇹🇷 Türkiye <span>TRY ₺</span></span></div><nav className="category-sheet-list" aria-label="Ürün kategorileri">{categories.map(c=><Link href={`/katalog?category=${c.slug}`} key={c.slug} onClick={close}><Image src={c.image} width={36} height={30} alt="" unoptimized/><span>{c.name}</span><ChevronRight size={14}/></Link>)}<Link className="category-sheet-all" href="/katalog" onClick={close}><Menu size={18}/><span>Tüm ürünler</span><ChevronRight size={14}/></Link></nav><nav className="category-sheet-footer" aria-label="Hesap ve bilgi"><Link href="/giris" onClick={close}><UserRound size={15}/><span>Giriş yap</span></Link><Link href="/bilgi/hakkimizda" onClick={close}><Info size={15}/><span>Bilgi</span><ChevronRight size={14}/></Link><Link href="/iletisim" onClick={close}><Mail size={15}/><span>İletişim</span></Link></nav></dialog></div>;
}
