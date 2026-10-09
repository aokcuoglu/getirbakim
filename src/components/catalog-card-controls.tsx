"use client";
import {createContext,useContext,useState,useRef,type ReactNode} from "react";
import Link from "next/link";
import {X} from "lucide-react";
import {specificationLabel,specificationValue} from "@/modules/store/catalog-filters";
type Entry={id:string;title:string;price:string;specifications:[string,string][]};
const CompareContext=createContext<{entries:Entry[];toggle:(entry:Entry)=>void}>({entries:[],toggle:()=>{}});
export function ComparisonProvider({children}:{children:ReactNode}){
 const [entries,setEntries]=useState<Entry[]>([]);const dialog=useRef<HTMLDialogElement>(null);
 function toggle(entry:Entry){setEntries(current=>current.some(e=>e.id===entry.id)?current.filter(e=>e.id!==entry.id):current.length<3?[...current,entry]:current);}
 const keys=[...new Set(entries.flatMap(e=>e.specifications.map(([key])=>key)))];
 return <CompareContext.Provider value={{entries,toggle}}>{children}{entries.length>0&&<div className="catalog-compare-tray"><span>{entries.length}/3 ürün seçildi</span><button disabled={entries.length<2} onClick={()=>dialog.current?.showModal()}>Karşılaştır</button><button aria-label="Karşılaştırmayı temizle" onClick={()=>setEntries([])}><X size={16}/></button></div>}
 <dialog ref={dialog} className="catalog-comparison" aria-labelledby="catalog-comparison-title"><button className="comparison-close" aria-label="Karşılaştırmayı kapat" onClick={()=>dialog.current?.close()}><X size={20}/></button><h2 id="catalog-comparison-title">Ürün karşılaştırması</h2><div className="comparison-scroll"><table><thead><tr><th>Özellik</th>{entries.map(e=><th key={e.id}><Link href={"/urun/"+e.id}>{e.title}</Link></th>)}</tr></thead><tbody><tr><th>Fiyat</th>{entries.map(e=><td key={e.id}>{e.price}</td>)}</tr>{keys.map(key=><tr key={key}><th>{specificationLabel(key)}</th>{entries.map(e=><td key={e.id}>{specificationValue(e.specifications.find(s=>s[0]===key)?.[1]??"—")}</td>)}</tr>)}</tbody></table></div></dialog></CompareContext.Provider>;
}
export function CompareCheckbox({entry}:{entry:Entry}){
 const {entries,toggle}=useContext(CompareContext),checked=entries.some(e=>e.id===entry.id);
 return <label className="listing-compare"><input type="checkbox" checked={checked} disabled={!checked&&entries.length>=3} onChange={()=>toggle(entry)}/><span>Karşılaştırmaya ekle ({entries.length}/3)</span></label>;
}
export function CardSpecifications({specifications}:{specifications:[string,string][]}){
 const [expanded,setExpanded]=useState(false);
 const priority=["Fitting Position","Brake Disc Type","Outer Diameter [mm]","Brake Disc Thickness [mm]"];
 const ordered=specifications.some(([key])=>key==="Brake Disc Type")?[...specifications].sort(([a],[b])=>(priority.includes(a)?priority.indexOf(a):priority.length)-(priority.includes(b)?priority.indexOf(b):priority.length)):specifications;
 return <div className="listing-specs"><dl>{(expanded?ordered:ordered.slice(0,4)).map(([key,value],index)=><div key={key+index}><dt>{specificationLabel(key)}:</dt><dd>{specificationValue(value)}</dd></div>)}</dl>{specifications.length>4&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"Daha az göster":"Tümünü göster"}</button>}</div>;
}
