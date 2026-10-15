"use client";

import {useEffect,useState,type ReactNode} from "react";
import {cn} from "@/lib/utils";

export function CatalogStickyFinder({children,brakes}:{children:ReactNode;brakes:boolean}){
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  const update=()=>{
   const scrolled=window.scrollY>173;
   setVisible(scrolled);
   if(scrolled)document.body.dataset.catalogScrolled="true";
   else delete document.body.dataset.catalogScrolled;
  };
  update();
  window.addEventListener("scroll",update,{passive:true});
  return()=>{window.removeEventListener("scroll",update);delete document.body.dataset.catalogScrolled;};
 },[]);
 // Sits under the compact header (88px) that the site header shows while body[data-catalog-scrolled] is set.
 return <div className={cn("fixed inset-x-0 top-[88px] z-40 h-20 bg-[#212b36] max-[600px]:hidden! [&[hidden]]:hidden",
  brakes&&"bg-[linear-gradient(#212b36cc,#212b36cc),url('/media/site/images/brake-system-banner.webp')] bg-cover bg-center")} hidden={!visible}>{children}</div>;
}
