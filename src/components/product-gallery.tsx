"use client";

import Image from "next/image";
import { X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ProductGallery({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return <Dialog>
    <DialogTrigger className="group/zoom relative flex rounded-none border-0 h-[540px] w-full cursor-zoom-in items-center justify-center bg-white px-6 py-[30px] text-[#53677d] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 min-[1450px]:h-[600px] max-[1000px]:h-[440px] max-[750px]:h-[340px] max-[750px]:p-3" aria-label={`${alt} görselini büyüt`}>
      <Image className="block size-full object-contain" src={src} alt={alt} width={width} height={height} sizes="(max-width: 750px) 95vw, 600px" preload unoptimized />
      <span className="absolute right-5 bottom-4 opacity-0 transition-opacity group-hover/zoom:opacity-100 group-focus-visible/zoom:opacity-100 motion-reduce:transition-none"><ZoomIn size={19}/></span>
    </DialogTrigger>
    <DialogContent showCloseButton={false} overlayClassName="bg-[#172331b3] supports-backdrop-filter:backdrop-blur-none" className="w-[min(900px,95vw)] max-w-none rounded-lg bg-white p-10 ring-0 sm:max-w-none max-[750px]:px-3 max-[750px]:pt-10 max-[750px]:pb-3 data-open:zoom-in-100">
      <DialogTitle className="sr-only">{alt}</DialogTitle>
      <DialogClose render={<Button variant="secondary" size="icon-lg" className="min-h-0 p-0 absolute top-2.5 right-2.5 size-10 rounded-full bg-[#f7f8fa] text-foreground"/>} aria-label="Görseli kapat"><X className="size-6"/></DialogClose>
      <Image className="block h-[min(700px,72vh)] w-full object-contain" src={src} alt={alt} width={width} height={height} sizes="90vw" unoptimized />
    </DialogContent>
  </Dialog>;
}
