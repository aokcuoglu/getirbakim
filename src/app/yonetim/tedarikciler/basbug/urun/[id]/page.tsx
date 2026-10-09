import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, money } from "@/modules/store/catalog";
import { adminBasbugItem } from "@/modules/admin/basbug";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, StatusBadge } from "@/components/admin/ui";

const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const warehouseNames: Record<string, string> = { MRK: "Merkez", IZM: "İzmir" };
const changeKinds: Record<string, string> = { added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" };

function Fields({ values }: { values: Record<string, unknown> }) {
  return <dl className="supplier-fields">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value === null || value === undefined || value === "" ? "—" : String(value)}</dd></div>)}</dl>;
}

export default async function SupplierItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminBasbugItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const sale = await getProduct(item.id);
  const depots = Object.entries(item.stock_data?.depolar ?? {});
  const listHref = `/yonetim/tedarikciler/basbug?group=${encodeURIComponent(item.list_group)}`;
  return <AdminPage className="supplier-admin">
    <AdminPageHeader
      breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Başbuğ", href: listHref }, { label: item.code }]}
      eyebrow="Tedarikçi ürün detayı" title={item.code}
      description={<>{p.ac} · {p.uk}<br/>{item.list_group} / {item.warehouse} · Çekim: {date(item.completed_at)} (İstanbul)</>}
      actions={<StatusBadge tone={item.presence === "present" ? "success" : "warning"}>{item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif — iki başarılı çekimde bulunamadı" : "Son listede bulunamadı"}</StatusBadge>}/>
    <p className="admin-hint">İlk görülme: {date(item.first_seen_at)} · Son değişim: {date(item.changed_at)}</p>
    <AdminColumns>
      <AdminPanel title="Ürün bilgileri" description="Model, motor ve yıl alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.">
        <Fields values={{ "Ek açıklama": p.ac2, "OEM referansları": p.oe, "Model açıklaması": p.m, "Motor açıklaması": p.mo, "Yıl açıklaması": p.y, "Birim": p.b, "Liste grubu": p.lgk, "MKK (kaynak)": p.mkk }}/>
      </AdminPanel>
      <AdminPanel title="Kaynak fiyat ve stok" description="NF, KDV hariç maliyettir. LF, MIF ve K satış hesaplamasında kullanılmaz. Stok sinyalleri adet değildir.">
        <Fields values={{ "Para birimi": p.dc, LF: p.lf, "NF · KDV hariç maliyet": item.price_data?.nf ?? "Eksik", MIF: item.price_data?.mif ?? "Eksik", K: item.price_data?.k ?? "Eksik", "Yolda sinyali": item.stock_data?.sYol ?? "Eksik", "Farklı depo sinyali": item.stock_data?.sFarkliDepo ?? "Eksik" }}/>
        <h3>Depo stokları</h3>
        {depots.length ? <dl className="supplier-fields">{depots.map(([depot, signal]) => <div key={depot}><dt>{warehouseNames[depot] ?? depot} ({depot})</dt><dd>{signal.stok > 0 ? "Var" : "Yok"}{signal.sYol > 0 ? " · Yolda" : ""}</dd></div>)}</dl>
          : <Fields values={{ "MRK stok sinyali": item.stock_data?.stok ?? "Eksik" }}/>}
        {!depots.length && <p className="admin-hint">Depo bazlı stok sonraki çekimde gelecek.</p>}
      </AdminPanel>
    </AdminColumns>
    <AdminPanel title="Getirbakim satış fiyatı" actions={<><Link className="admin-link" href="/yonetim/fiyatlandirma">Kâr ve KDV oranları →</Link>{sale && <Link className="admin-link" href={`/urun/${sale.id}`}>Katalogda aç →</Link>}</>}>
      <p className="supplier-sale-price">{sale?.price_kurus ? money(sale.price_kurus) : "Güncel fiyat bulunamadı"}</p>
      <p className="admin-hint">KDV dahil · {sale?.stock_label ?? "Satışa kapalı"}</p>
    </AdminPanel>
    <AdminPanel title="Değişiklik geçmişi" description="Son 90 gün içindeki en son 20 değişiklik gösterilir. Değişmeyen çekimler yeni geçmiş satırı oluşturmaz.">
      {item.changes.length ? item.changes.map(change => <details key={change.id}><summary>{date(change.changed_at)} · {changeKinds[change.kind]}</summary><pre className="supplier-json">{JSON.stringify({ önce: change.before_data, sonra: change.after_data }, null, 2)}</pre></details>) : <p className="admin-hint">Kayıtlı değişiklik yok.</p>}
    </AdminPanel>
    <AdminPanel title="Veri kontrolü" actions={item.conflicting ? <StatusBadge tone="warning">İnceleme gerekli</StatusBadge> : undefined}>
      <p>Kaynak satır sayısı — Ürün: {item.product_count}, fiyat: {item.price_count}, stok: {item.stock_count}.</p>
      <p>{item.conflicting ? "Aynı kod için farklı yanıtlar bulundu. Kayıt inceleme gerektiriyor; farklı kaynak değerleri aşağıda saklanıyor." : "Bu kayıt için çelişkili tekrar bulunmadı."}</p>
      <details><summary>Kaynak alanlarını göster</summary><pre className="supplier-json">{JSON.stringify({ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }, null, 2)}</pre></details>
    </AdminPanel>
  </AdminPage>;
}
