"use client";
import {createContext,useContext,useState,type ReactNode} from "react";
import Link from "next/link";
import {X} from "lucide-react";
import {specificationLabel,specificationValue} from "@/modules/store/catalog-filters";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Dialog,DialogContent,DialogTitle} from "@/components/ui/dialog";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
type Entry={id:string;title:string;price:string;specifications:[string,string][]};
const CompareContext=createContext<{entries:Entry[];toggle:(entry:Entry)=>void}>({entries:[],toggle:()=>{}});
const head="font-bold ";
const cell="border-b border-[#dfe3e8] p-3 text-left align-top whitespace-normal";
export function ComparisonProvider({children}:{children:ReactNode}){
 const [entries,setEntries]=useState<Entry[]>([]);const [open,setOpen]=useState(false);
 function toggle(entry:Entry){setEntries(current=>current.some(e=>e.id===entry.id)?current.filter(e=>e.id!==entry.id):current.length<3?[...current,entry]:current);}
 const keys=[...new Set(entries.flatMap(e=>e.specifications.map(([key])=>key)))];
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
    <TableHeader><TableRow className="border-0 hover:bg-transparent"><TableHead className={head+cell}>Özellik</TableHead>{entries.map(e=><TableHead key={e.id} className={head+cell}><Link className="hover:text-primary hover:underline" href={"/urun/"+e.id}>{e.title}</Link></TableHead>)}</TableRow></TableHeader>
    <TableBody><TableRow className="border-0 hover:bg-transparent"><TableHead className={head+cell}>Fiyat</TableHead>{entries.map(e=><TableCell key={e.id} className={cell}>{e.price}</TableCell>)}</TableRow>
    {keys.map(key=><TableRow key={key} className="border-0 hover:bg-transparent"><TableHead className={head+cell}>{specificationLabel(key)}</TableHead>{entries.map(e=><TableCell key={e.id} className={cell}>{specificationValue(e.specifications.find(s=>s[0]===key)?.[1]??"—")}</TableCell>)}</TableRow>)}</TableBody>
   </Table>
  </DialogContent>
 </Dialog></CompareContext.Provider>;
}
export function CompareCheckbox({entry}:{entry:Entry}){
 const {entries,toggle}=useContext(CompareContext),checked=entries.some(e=>e.id===entry.id);
 return <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm leading-5 font-normal has-data-disabled:cursor-not-allowed group-data-[view=grid]/listing:order-4 max-[600px]:group-data-[view=grid]/listing:hidden">
  <Checkbox className="size-5 rounded-[4px] border-input bg-white data-checked:border-brand data-checked:bg-brand [&_svg]:size-3.5!" checked={checked} disabled={!checked&&entries.length>=3} onCheckedChange={()=>toggle(entry)}/>
  <span>Karşılaştırmaya ekle ({entries.length}/3)</span>
 </label>;
}
export function CardSpecifications({specifications}:{specifications:[string,string][]}){
 const [expanded,setExpanded]=useState(false);
 const priority=["Fitting Position","Brake Disc Type","Outer Diameter [mm]","Brake Disc Thickness [mm]"];
 const ordered=specifications.some(([key])=>key==="Brake Disc Type")?[...specifications].sort(([a],[b])=>(priority.includes(a)?priority.indexOf(a):priority.length)-(priority.includes(b)?priority.indexOf(b):priority.length)):specifications;
 return <div className="col-start-1 my-4 min-w-0 self-start max-[1358px]:w-[250px] max-[1358px]:max-w-full max-[600px]:mt-8 max-[600px]:w-full group-data-[view=grid]/listing:min-h-[132px] group-data-[view=grid]/listing:w-auto max-[600px]:group-data-[view=grid]/listing:hidden">
  <dl className="text-sm leading-5">{(expanded?ordered:ordered.slice(0,4)).map(([key,value],index)=><div key={key+index} className="mb-2 flex flex-wrap gap-x-[5px] wrap-anywhere"><dt className="font-normal text-muted-foreground">{specificationLabel(key)}:</dt><dd className="font-medium text-foreground">{specificationValue(value)}</dd></div>)}</dl>
  {specifications.length>4&&<button type="button" className="min-h-5 cursor-pointer rounded-none border-0 bg-transparent p-0 text-sm leading-5 font-medium text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"Daha az göster":"Tümünü göster"}</button>}
 </div>;
}
