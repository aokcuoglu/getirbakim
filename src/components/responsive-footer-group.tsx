"use client";

import {useEffect,useRef,type ReactNode} from "react";
import {ChevronDown} from "lucide-react";

export function ResponsiveFooterGroup({title,children}:{title:string;children:ReactNode}) {
  const ref=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const query=window.matchMedia("(max-width: 600px)");
    const update=()=>{if(ref.current)ref.current.open=!query.matches;};
    update();query.addEventListener("change",update);
    return()=>query.removeEventListener("change",update);
  },[]);
  return <details className="home-footer-group" ref={ref} open><summary><h2>{title}</h2><ChevronDown size={16}/></summary><div className="home-footer-group-body">{children}</div></details>;
}
