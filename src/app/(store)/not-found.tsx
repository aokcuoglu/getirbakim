import Link from "next/link";

export default function NotFound() {
  return <div className="store-not-found"><div className="store-not-found-title"><h1>Ürün bulunamadı.</h1></div><div className="store-not-found-text">Ürün koduyla yeniden arama yapabilirsin.</div><Link href="/" className="store-cta">Parça ara ↗</Link></div>;
}
