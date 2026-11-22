"use client";
import Image from "next/image";
import Link from "next/link";
import {useSlideImages} from "@/components/home-slide-images";

export type TileLogo = [src: string, width: number, height: number];

// Client views (#1289): the tile markup goes out once as HTML instead of twice (HTML and the RSC payload).
export function HomeMakeTile({href, label, logo}: {href: string; label: string; logo?: TileLogo}) {
  const images = useSlideImages();
  return <Link prefetch={false} href={href} aria-label={label} className="home-make-tile">{logo && images && <Image src={logo[0]} width={logo[1]} height={logo[2]} alt={`${label} logosu`} unoptimized className="make-tile-logo"/>}<span className="make-tile-name">{label}</span></Link>;
}

export function HomeBrandTile({href, brand, logo}: {href: string; brand: string; logo?: TileLogo}) {
  const images = useSlideImages();
  return <Link prefetch={false} href={href} aria-label={`${brand} ürünleri`} className="home-brand-tile">{logo && images ? <Image src={logo[0]} width={logo[1]} height={logo[2]} alt={brand} unoptimized className="home-brand-logo"/> : <span>{brand}</span>}</Link>;
}
