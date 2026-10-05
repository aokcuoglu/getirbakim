import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PartArt } from "./part-art";
import { categories,money,servicePrice,type Product } from "@/modules/store/catalog";
import type { Account } from "@/modules/auth/session";
export function ProductCard({product:p,account}:{product:Product;account:Account|null}) {
 const discounted=Boolean(account?.approved && account.role==="service");
 return <Link href={`/urun/${p.id}`} className="product-card"><div className="product-image">{p.supplier==="demo" && <span className="demo-label">Örnek ürün</span>}<PartArt kind={categories.find(c=>c.slug===p.category)?.art}/></div><div className="product-info"><span className="product-brand">{p.brand}</span><h3>{p.name}</h3><p className="product-code">Ürün kodu: {p.code}</p><p className={`stock ${!p.stock ? "no-stock" : ""}`}>{p.stock ? "Katalogda stok mevcut" : "Stokta yok"}</p><div className="product-price"><strong>{money(servicePrice(p.price_kurus,discounted ? account!.discount_percent : 0))}</strong><ArrowRight size={18}/></div><small>{discounted ? "Servisine özel B2B fiyatı" : "Bireysel satış fiyatı"}</small></div></Link>;
}
