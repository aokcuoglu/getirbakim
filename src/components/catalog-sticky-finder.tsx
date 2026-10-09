"use client";

import {useEffect,useState,type ReactNode} from "react";

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
 return <div className={"catalog-sticky-finder"+(brakes?" catalog-hero-brakes":"")} hidden={!visible}>{children}</div>;
}
