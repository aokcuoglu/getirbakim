"use client";
import { useState } from "react";
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SiteIcon } from "./site-icon";

export type SelectOption={value:string;label:string};

/**
 * The storefront's compact dropdown (header search mode, locale menus).
 * `className` sizes the control; `triggerClassName` / `contentClassName` restyle the button and the list.
 * The selected value is submitted with the surrounding form under `name`.
 */
export function Select({name,label,options,defaultValue="",value,className="",triggerClassName,contentClassName,align="start",onChange}:{name:string;label:string;options:SelectOption[];defaultValue?:string;value?:string;className?:string;triggerClassName?:string;contentClassName?:string;align?:"start"|"end";onChange?:(value:string)=>void}) {
 const [uncontrolledValue,setUncontrolledValue]=useState(()=>(options.find(o=>o.value===defaultValue)??options[0])?.value??"");
 const current=value??uncontrolledValue;
 return <SelectRoot name={name} items={options} value={current} modal={false} onValueChange={next=>{
  if(typeof next!=="string")return;
  if(value===undefined)setUncontrolledValue(next);
  onChange?.(next);
 }}>
  <SelectTrigger aria-label={label} className={cn(
   "group/select relative flex min-h-[52px] data-[size=default]:h-auto w-full min-w-[120px] max-w-full items-center justify-start gap-0 rounded-lg border border-input bg-white py-[13px] pr-9 pl-3.5 text-left text-sm leading-5 font-normal whitespace-nowrap text-foreground *:data-[slot=select-value]:block hover:border-[#54626e] hover:bg-[#f8f9f9] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand max-[600px]:text-[13px] [&>svg:last-child]:hidden",
   className,triggerClassName)}>
   <SelectValue className="block min-w-0 flex-1 truncate"/>
   <SiteIcon name="chevron" size={16} className="absolute top-[calc(50%-8px)] right-2.5 transition-transform duration-150 group-aria-expanded/select:rotate-180"/>
  </SelectTrigger>
  <SelectContent align={align} alignItemWithTrigger={false} sideOffset={4} className={cn(
   "max-h-[280px] w-(--anchor-width) min-w-40 rounded-xl border border-border bg-white py-2.5 text-foreground shadow-[0_6px_24px_rgba(33,43,54,.1)] ring-0",
   contentClassName)}>
   {options.map(option=><SelectItem key={option.value} value={option.value} className="min-h-9 cursor-pointer justify-between gap-2.5 rounded-none px-[15px] py-2 text-sm font-normal text-foreground focus:bg-[#f8f9f9] focus:text-foreground focus:**:text-foreground data-selected:font-medium [&>span:first-child]:whitespace-normal max-[600px]:text-[13px] [&>span.absolute]:hidden">
    {option.label}{option.value===current&&<SiteIcon name="check" size={14}/>}
   </SelectItem>)}
  </SelectContent>
 </SelectRoot>;
}
