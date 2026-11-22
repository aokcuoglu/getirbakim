"use client";
import Image from "next/image";
import Link from "next/link";
import {useSlideImages} from "@/components/home-slide-images";
import type {HomeProductCardModel} from "@/modules/store/listing-card";

// The image link only duplicates the title link: hidden from the tab order and AT, but named for crawlers; the image keeps its alt for image search (#1313).
// A client view (#1212): the card's markup goes out once as HTML instead of twice (HTML and the RSC payload).
export function HomeProductCardView({model: m}: {model: HomeProductCardModel}) {
  const images = useSlideImages();
  return <article className="home-card">
    <Link className="home-card-image" href={m.href} aria-label={m.title} aria-hidden="true" tabIndex={-1}>{m.image&&(images?<Image src={m.image} width={180} height={180} alt={m.title} className="home-card-img"/>:<span className="home-card-img rounded-md bg-muted"/>)}</Link>
    <div className="home-card-text">
      <Link className="home-card-category" href={m.categoryHref}>{m.categoryName}</Link>
      <Link className="home-card-title" href={m.href}>{m.title}</Link>
    </div>
    <div className="home-card-price">{m.note?m.note.href?<Link className="home-card-note home-card-note-link" href={m.note.href}>{m.note.text}</Link>:<span className="home-card-note">{m.note.text}</span>:<><strong className="home-card-amount">{m.amount}</strong>{m.regular!==undefined&&<s className="home-card-regular"><span className="sr-only">Önceki fiyat: </span>{m.regular}</s>}</>}</div>
  </article>;
}
