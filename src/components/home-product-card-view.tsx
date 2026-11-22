"use client";
import Image from "next/image";
import Link from "next/link";

/** A home page card as finished strings: no price formatting or name dictionary on the client. */
export type HomeProductCardModel = {
  href: string; title: string; image?: string; categoryHref: string; categoryName: string;
  /** Instead of a price: why there is none, linked to the product page's form when it can be requested. */
  note?: { text: string; href?: string };
  amount?: string;
  /** A running campaign's regular price, struck through. */
  regular?: string;
};

// A client view (#1212): the card's markup goes out once as HTML instead of twice (HTML and the RSC payload).
export function HomeProductCardView({model: m}: {model: HomeProductCardModel}) {
  return <article className="home-card">
    <Link className="home-card-image" href={m.href}>{m.image&&<Image src={m.image} width={180} height={180} alt={m.title} className="home-card-img"/>}</Link>
    <div className="home-card-text">
      <Link className="home-card-category" href={m.categoryHref}>{m.categoryName}</Link>
      <Link className="home-card-title" href={m.href}>{m.title}</Link>
    </div>
    <div className="home-card-price">{m.note?m.note.href?<Link className="home-card-note home-card-note-link" href={m.note.href}>{m.note.text}</Link>:<span className="home-card-note">{m.note.text}</span>:<><strong className="home-card-amount">{m.amount}</strong>{m.regular!==undefined&&<s className="home-card-regular"><span className="sr-only">Önceki fiyat: </span>{m.regular}</s>}<small className="home-card-tax">KDV dahil · Kargo hariç</small></>}</div>
  </article>;
}
