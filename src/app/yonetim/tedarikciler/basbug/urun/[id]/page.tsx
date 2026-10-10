import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, money } from "@/modules/store/catalog";
import { adminBasbugItem } from "@/modules/admin/basbug";
import { ChevronRight, History } from "lucide-react";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, EmptyState, StatusBadge } from "@/components/admin/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const warehouseNames: Record<string, string> = { MRK: "Merkez", IZM: "İzmir" };
const changeKinds: Record<string, string> = { added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" };

function Fields({ values }: { values: Record<string, unknown> }) {
  return <dl className="divide-y text-sm">{Object.entries(values).map(([key, value]) => <div key={key} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-2 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{key}</dt><dd className="break-words tabular-nums">{value === null || value === undefined || value === "" ? "—" : String(value)}</dd></div>)}</dl>;
}
const json = "mt-2 max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5";

export default async function SupplierItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminBasbugItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const sale = await getProduct(item.id);
  const depots = Object.entries(item.stock_data?.depolar ?? {});
  const listHref = `/yonetim/tedarikciler/basbug?group=${encodeURIComponent(item.list_group)}`;
  return <AdminPage>
    <AdminPageHeader
      breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Başbuğ", href: listHref }, { label: item.code }]}
      title={<span className="font-mono">{item.code}</span>}
      description={<>{p.ac} · {p.uk}<br/>{item.list_group} / {item.warehouse} · Çekim: {date(item.completed_at)} (İstanbul) · İlk görülme: {date(item.first_seen_at)} · Son değişim: {date(item.changed_at)}</>}
      actions={<StatusBadge tone={item.presence === "present" ? "success" : "warning"}>{item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif — iki başarılı çekimde bulunamadı" : "Son listede bulunamadı"}</StatusBadge>}/>
    <AdminColumns>
      <AdminPanel title="Ürün bilgileri" description="Model, motor ve yıl alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.">
        <Fields values={{ "Ek açıklama": p.ac2, "OEM referansları": p.oe, "Model açıklaması": p.m, "Motor açıklaması": p.mo, "Yıl açıklaması": p.y, "Birim": p.b, "Liste grubu": p.lgk, "MKK (kaynak)": p.mkk }}/>
      </AdminPanel>
      <AdminPanel title="Kaynak fiyat ve stok" description="NF, KDV hariç maliyettir. LF, MIF ve K satış hesaplamasında kullanılmaz. Stok sinyalleri adet değildir.">
        <Fields values={{ "Para birimi": p.dc, LF: p.lf, "NF · KDV hariç maliyet": item.price_data?.nf ?? "Eksik", MIF: item.price_data?.mif ?? "Eksik", K: item.price_data?.k ?? "Eksik", "Yolda sinyali": item.stock_data?.sYol ?? "Eksik", "Farklı depo sinyali": item.stock_data?.sFarkliDepo ?? "Eksik" }}/>
        <Separator className="my-4"/>
        <h3 className="mb-2 text-sm font-medium">Depo stokları</h3>
        {depots.length ? <Fields values={Object.fromEntries(depots.map(([depot, signal]) => [`${warehouseNames[depot] ?? depot} (${depot})`, `${signal.stok > 0 ? "Var" : "Yok"}${signal.sYol > 0 ? " · Yolda" : ""}`]))}/>
          : <><Fields values={{ "MRK stok sinyali": item.stock_data?.stok ?? "Eksik" }}/><p className="mt-2 text-xs text-muted-foreground">Depo bazlı stok sonraki çekimde gelecek.</p></>}
      </AdminPanel>
    </AdminColumns>
    <AdminPanel title="Getirbakim satış fiyatı" actions={<><Link className="font-medium text-primary hover:underline" href="/yonetim/fiyatlandirma">Kâr ve KDV oranları →</Link>{sale && <Link className="font-medium text-primary hover:underline" href={`/urun/${sale.id}`}>Katalogda aç →</Link>}</>}>
      <p className="text-2xl font-semibold tabular-nums">{sale?.price_kurus ? money(sale.price_kurus) : "Güncel fiyat bulunamadı"}</p>
      <p className="text-sm text-muted-foreground">KDV dahil · {sale?.stock_label ?? "Satışa kapalı"}</p>
    </AdminPanel>
    <AdminPanel title="Değişiklik geçmişi" description="Son 90 gün içindeki en son 20 değişiklik gösterilir. Değişmeyen çekimler yeni geçmiş satırı oluşturmaz." flush>
      {item.changes.length ? <div className="divide-y">{item.changes.map(change => <Collapsible key={change.id} className="px-4 py-2.5">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-sm"><ChevronRight className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/><span className="tabular-nums">{date(change.changed_at)}</span><StatusBadge tone={change.kind === "added" || change.kind === "restored" ? "success" : change.kind === "changed" ? "info" : "warning"}>{changeKinds[change.kind]}</StatusBadge></CollapsibleTrigger>
        <CollapsibleContent><pre className={json}>{JSON.stringify({ önce: change.before_data, sonra: change.after_data }, null, 2)}</pre></CollapsibleContent>
      </Collapsible>)}</div> : <EmptyState title="Kayıtlı değişiklik yok" icon={<History/>}/>}
    </AdminPanel>
    <AdminPanel title="Veri kontrolü" actions={item.conflicting ? <StatusBadge tone="warning">İnceleme gerekli</StatusBadge> : undefined}>
      <p className="text-sm">Kaynak satır sayısı — Ürün: {item.product_count}, fiyat: {item.price_count}, stok: {item.stock_count}.</p>
      <p className="mt-1 text-sm text-muted-foreground">{item.conflicting ? "Aynı kod için farklı yanıtlar bulundu. Kayıt inceleme gerektiriyor; farklı kaynak değerleri aşağıda saklanıyor." : "Bu kayıt için çelişkili tekrar bulunmadı."}</p>
      <Collapsible className="mt-3"><CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-medium hover:underline"><ChevronRight className="size-4 transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/>Kaynak alanlarını göster</CollapsibleTrigger>
        <CollapsibleContent><pre className={json}>{JSON.stringify({ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }, null, 2)}</pre></CollapsibleContent></Collapsible>
    </AdminPanel>
  </AdminPage>;
}
