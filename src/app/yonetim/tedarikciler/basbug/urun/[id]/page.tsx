import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, money } from "@/modules/store/catalog";
import { adminBasbugItem } from "@/modules/admin/basbug";

export default async function SupplierItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminBasbugItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const sale = await getProduct(item.id);
  return <section className="shell page-section supplier-admin">
    <nav className="breadcrumbs"><Link href="/yonetim">Yönetim</Link><span> / </span><Link href={`/yonetim/tedarikciler/basbug?group=${encodeURIComponent(item.list_group)}`}>Başbuğ ürünleri</Link></nav>
    <p className="eyebrow">TEDARİKÇİ ÜRÜN DETAYI</p><h1 className="page-title">{item.code}</h1><p>{p.ac} · {p.uk}</p><p className="muted">{item.list_group} / {item.warehouse} · {item.completed_at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} (İstanbul)</p>
    <p className={item.presence === "present" ? "muted" : "error"}>Durum: {item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif — iki başarılı çekimde bulunamadı" : "Son listede bulunamadı"} · İlk görülme: {item.first_seen_at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · Son değişim: {item.changed_at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
    <div className="supplier-detail-grid"><article className="panel"><h2>Ürün bilgileri</h2><dl className="supplier-fields">{Object.entries({ "Ek açıklama": p.ac2, "OEM referansları": p.oe, "Model açıklaması": p.m, "Motor açıklaması": p.mo, "Yıl açıklaması": p.y, "Birim": p.b, "Liste grubu": p.lgk, "MKK (kaynak)": p.mkk }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || "—"}</dd></div>)}</dl><p className="muted">Model, motor ve yıl alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</p></article>
    <article className="panel"><h2>Kaynak fiyat ve stok</h2><dl className="supplier-fields">{Object.entries({ "Para birimi": p.dc, LF: p.lf, "NF · KDV hariç maliyet": item.price_data?.nf ?? "Eksik", MIF: item.price_data?.mif ?? "Eksik", K: item.price_data?.k ?? "Eksik", "MRK stok sinyali": item.stock_data?.stok ?? "Eksik", "Yolda sinyali": item.stock_data?.sYol ?? "Eksik", "Farklı depo sinyali": item.stock_data?.sFarkliDepo ?? "Eksik" }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl><p className="muted">NF, KDV hariç maliyettir. LF, MIF ve K satış hesaplamasında kullanılmaz. Stok sinyalleri adet değildir.</p></article></div>
    <article className="panel"><h2>Getirbakim satış fiyatı</h2><p className="price">{sale?.price_kurus ? money(sale.price_kurus) : "Güncel fiyat bulunamadı"}</p><p className="muted">KDV dahil · {sale?.stock_label ?? "Satışa kapalı"}</p><Link href="/yonetim/fiyatlandirma">Kâr ve KDV oranlarını yönet →</Link>{sale && <p><Link href={`/urun/${sale.id}`}>Katalogdaki ürünü aç →</Link></p>}</article>
    <article className="panel"><h2>Değişiklik geçmişi</h2><p>Son 90 gün içindeki en son 20 değişiklik gösterilir. Değişmeyen çekimler yeni geçmiş satırı oluşturmaz.</p>
      {item.changes.map(change => <details key={change.id}><summary>{change.changed_at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {({ added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" } as Record<string,string>)[change.kind]}</summary><pre className="supplier-json">{JSON.stringify({ önce: change.before_data, sonra: change.after_data }, null, 2)}</pre></details>)}
    </article>
    <article className="panel"><h2>Veri kontrolü</h2><p>Kaynak satır sayısı — Ürün: {item.product_count}, fiyat: {item.price_count}, stok: {item.stock_count}.</p><p>{item.conflicting ? "Aynı kod için farklı yanıtlar bulundu. Kayıt inceleme gerektiriyor; farklı kaynak değerleri aşağıda saklanıyor." : "Bu kayıt için çelişkili tekrar bulunmadı."}</p><details><summary>Kaynak alanlarını göster</summary><pre className="supplier-json">{JSON.stringify({ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }, null, 2)}</pre></details></article>
  </section>;
}
