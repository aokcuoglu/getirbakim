"use client";
import { useId,useRef,useState,useEffect } from "react";
import { SiteIcon } from "./site-icon";
export type SelectOption={value:string;label:string};
export function Select({name,label,options,defaultValue="",value,className="",onChange}:{name:string;label:string;options:SelectOption[];defaultValue?:string;value?:string;className?:string;onChange?:(value:string)=>void}) {
 const initial=Math.max(0,options.findIndex(o=>o.value===defaultValue));
 const [uncontrolledValue,setUncontrolledValue]=useState(options[initial]?.value ?? ""),[active,setActive]=useState(initial),[open,setOpen]=useState(false);
 const selected=Math.max(0,options.findIndex(option=>option.value===(value ?? uncontrolledValue)));
 const id=useId();const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{function close(e:PointerEvent){if(root.current&&!root.current.contains(e.target as Node))setOpen(false);}document.addEventListener("pointerdown",close);return()=>document.removeEventListener("pointerdown",close);},[]);
 useEffect(()=>{if(open)root.current?.querySelector('[role="option"].active')?.scrollIntoView({block:"nearest"});},[active,open]);
 function choose(index:number){if(!options[index])return;if(value===undefined)setUncontrolledValue(options[index].value);setActive(index);setOpen(false);onChange?.(options[index].value);trigger.current?.focus();}
 return <div className={`ui-select ${className} ${open ? "is-open" : ""}`} ref={root}><input type="hidden" name={name} value={options[selected]?.value ?? ""}/><button ref={trigger} type="button" className="select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={()=>{setActive(selected);setOpen(!open);}} onKeyDown={e=>{
 if(!options.length)return;
 if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(!open){setActive(selected);setOpen(true);}else setActive((active+(e.key==="ArrowDown"?1:-1)+options.length)%options.length);}
 else if(e.key==="Home"||e.key==="End"){e.preventDefault();setOpen(true);setActive(e.key==="Home"?0:options.length-1);}
 else if(e.key==="Enter"||e.key===" "){e.preventDefault();if(open)choose(active);else{setActive(selected);setOpen(true);}}
 else if(e.key==="Escape"||e.key==="Tab")setOpen(false);
 }}><span>{options[selected]?.label}</span><SiteIcon name="chevron" size={16}/></button>{open && <div className="select-options" id={id} role="listbox" aria-label={label}>{options.map((o,i)=><div key={o.value} id={`${id}-${i}`} role="option" aria-selected={selected===i} className={active===i ? "active" : ""} onPointerMove={()=>setActive(i)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(i)}>{o.label}{selected===i && <SiteIcon name="check" size={14}/>}</div>)}</div>}</div>;
}
