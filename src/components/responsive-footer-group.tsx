"use client";

import {useState,type ReactNode} from "react";
import {ChevronDown} from "lucide-react";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "@/components/ui/collapsible";
import {useMediaQuery,useStoreRoute} from "@/components/layout/store-route";
import {cn} from "@/lib/utils";

/**
 * A footer link group. On the home page it collapses into an accordion row on phones (closed by default);
 * everywhere else, and on wider screens, it is a plain titled column.
 */
export function ResponsiveFooterGroup({title,children,accent=false}:{title:string;children:ReactNode;accent?:boolean}) {
  const phone=useMediaQuery("(max-width: 599.98px)");
  const collapsible=useStoreRoute()==="home"&&phone;
  const [open,setOpen]=useState(false);
  // Phones: each link is a 44px row (#1091); wider screens keep the compact column.
  const links=accent?"footer-links-accent":"footer-links";
  if(!collapsible) return <nav aria-label={title} className="min-w-0"><h2 className="footer-group-title">{title}</h2><div className={links}>{children}</div></nav>;
  return <Collapsible open={open} onOpenChange={setOpen}>
    <h2 className="m-0 text-sm leading-5 font-semibold">
      <CollapsibleTrigger className="flex h-auto min-h-0 w-full cursor-pointer items-center justify-between rounded-none border-0 border-b border-border bg-transparent px-0 py-4 text-left text-sm leading-5 font-semibold text-foreground hover:bg-transparent [&[data-panel-open]>svg]:rotate-180">
        {title}<ChevronDown size={16}/>
      </CollapsibleTrigger>
    </h2>
    <CollapsibleContent className={cn("py-3",links)}>{children}</CollapsibleContent>
  </Collapsible>;
}
