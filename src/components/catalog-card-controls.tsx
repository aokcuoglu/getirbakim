"use client";
import {createContext,useContext,useId,useState,type ReactNode} from "react";
import Link from "next/link";
import {X} from "lucide-react";
import type {CardSpecification} from "@/modules/store/specification-translations";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogTitle} from "@/components/ui/dialog";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
import {StoreCheckbox} from "@/components/site/store-checkbox";
type Entry={id:string;href:string;title:string;price:string;card:CardSpecification[]};
const CompareContext=createContext<{entries:Entry[];toggle:(entry:Entry)=>void}>({entries:[],toggle:()=>{}});
const head="font-bold ";
const cell="border-b border-[#dfe3e8] p-3 text-left align-top whitespace-normal";
export function ComparisonProvider({children}:{children:ReactNode}){
 const [entries,setEntries]=useState<Entry[]>([]);const [open,setOpen]=useState(false);
 function toggle(entry:Entry){setEntries(current=>current.some(e=>e.id===entry.id)?current.filter(e=>e.id!==entry.id):current.length<3?[...current,entry]:current);}
 // Rows group by the Turkish label, so keys that read the same (case variants, "Toplam uzunluk") share one row; a product shows its first non-empty value.
 const labels=[...new Set(entries.flatMap(e=>e.card.map(row=>row.label)))];
 const valueOf=(e:Entry,label:string)=>e.card.find(row=>row.label===label&&row.value.trim())?.value??"—";
 return <CompareContext.Provider value={{entries,toggle}}>{children}
 {entries.length>0&&<div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-[#dfe3e8] bg-white px-5 py-3 text-sm whitespace-nowrap shadow-[0_6px_24px_#0002] max-[600px]:max-w-[95vw] max-[600px]:gap-2 max-[600px]:p-2.5 max-[600px]:text-xs">
  <span>{entries.length}/3 ürün seçildi</span>
  <Button className="h-8 min-h-0 rounded-[4px] bg-brand px-3 text-sm hover:bg-brand-strong" disabled={entries.length<2} onClick={()=>setOpen(true)}>Karşılaştır</Button>
  <Button variant="ghost" size="icon" className="min-h-0 p-0 bg-transparent text-foreground" aria-label="Karşılaştırmayı temizle" onClick={()=>setEntries([])}><X className="size-4"/></Button>
 </div>}
 <Dialog open={open} onOpenChange={setOpen}>
  <DialogContent showCloseButton={false} overlayClassName="bg-[#212b3680] supports-backdrop-filter:backdrop-blur-none" className="block max-h-[85dvh] w-auto max-w-[min(1000px,95vw)] overflow-auto rounded-[10px] border border-[#dfe3e8] bg-white p-8 ring-0 sm:max-w-[min(1000px,95vw)]">
   <Button variant="ghost" size="icon" className="min-h-0 p-0 absolute top-3 right-3 bg-transparent text-foreground" aria-label="Karşılaştırmayı kapat" onClick={()=>setOpen(false)}><X className="size-5"/></Button>
   <DialogTitle className="mb-6 text-[26px] leading-[34px] font-semibold">Ürün karşılaştırması</DialogTitle>
   <Table className="min-w-[600px] border-collapse text-sm">
    <TableHeader><TableRow className="border-0 hover:bg-transparent"><TableHead className={head+cell}>Özellik</TableHead>{entries.map(e=><TableHead key={e.id} className={head+cell}><Link className="hover:text-primary hover:underline" href={e.href}>{e.title}</Link></TableHead>)}</TableRow></TableHeader>
    <TableBody><TableRow className="border-0 hover:bg-transparent"><TableHead className={head+cell}>Fiyat</TableHead>{entries.map(e=><TableCell key={e.id} className={cell}>{e.price}</TableCell>)}</TableRow>
    {labels.map(label=><TableRow key={label} className="border-0 hover:bg-transparent"><TableHead className={head+cell}>{label}</TableHead>{entries.map(e=><TableCell key={e.id} className={cell}>{valueOf(e,label)}</TableCell>)}</TableRow>)}</TableBody>
   </Table>
  </DialogContent>
 </Dialog></CompareContext.Provider>;
}
export function CompareCheckbox({entry}:{entry:Entry}){
 const {entries,toggle}=useContext(CompareContext),checked=entries.some(e=>e.id===entry.id);
 return <label className="product-card-compare">
  <StoreCheckbox checked={checked} disabled={!checked&&entries.length>=3} onCheckedChange={()=>toggle(entry)}/>
  <span>Karşılaştırmaya ekle ({entries.length}/3)</span>
 </label>;
}
export function CardSpecifications({card}:{card:CardSpecification[]}){
 const [expanded,setExpanded]=useState(false);
 const listId=useId();
 const priority=["Fitting Position","Brake Disc Type","Outer Diameter [mm]","Brake Disc Thickness [mm]"];
 const ordered=card.some(row=>row.key==="Brake Disc Type")?[...card].sort((a,b)=>(priority.includes(a.key)?priority.indexOf(a.key):priority.length)-(priority.includes(b.key)?priority.indexOf(b.key):priority.length)):card;
 // The toggle is always rendered: a phone's grid card folds every row behind it and its list card shows two rows (#878);
 // from 600px it shows only with more than four rows (data-many, catalog-card.css). Folded, it reads "Tümünü göster"
 // where some rows show and "Teknik özellikleri göster" in the phone grid, where none do.
 return <div className="product-card-specs" data-expanded={expanded}>
  <dl id={listId} className="product-card-spec-list">{(expanded?ordered:ordered.slice(0,4)).map(({key,label,value},index)=><div key={key+index} className="product-card-spec"><dt className="product-card-spec-label">{label}:</dt><dd className="product-card-spec-value">{value}</dd></div>)}</dl>
  {card.length>0&&<button type="button" className="product-card-specs-toggle" data-many={card.length>4} data-few={card.length<=2} aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpanded(!expanded)}>{expanded?"Daha az göster":<><span className="product-card-specs-more">Tümünü göster</span><span className="product-card-specs-show">Teknik özellikleri göster</span></>}</button>}
 </div>;
}
