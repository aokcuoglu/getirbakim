"use client";

import Image from "next/image";
import { useRef } from "react";
import { X, ZoomIn } from "lucide-react";

export function ProductGallery({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="pdp-image-button" onClick={() => dialog.current?.showModal()} aria-label={`${alt} görselini büyüt`}>
      <Image src={src} alt={alt} width={width} height={height} sizes="(max-width: 750px) 95vw, 600px" preload unoptimized />
      <span className="pdp-zoom"><ZoomIn size={19}/></span>
    </button>
    <dialog ref={dialog} className="pdp-lightbox" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} aria-label={alt}>
      <button type="button" className="pdp-lightbox-close" onClick={() => dialog.current?.close()} aria-label="Görseli kapat"><X size={24}/></button>
      <Image src={src} alt={alt} width={width} height={height} sizes="90vw" unoptimized />
    </dialog>
  </>;
}
