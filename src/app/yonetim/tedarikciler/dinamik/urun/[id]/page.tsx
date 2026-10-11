import { notFound } from "next/navigation";
import { ChevronRight, History } from "lucide-react";
import { adminDinamikItem } from "@/modules/admin/dinamik";
import { dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, EmptyState, StatusBadge } from "@/components/admin/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const changeKinds: Record<string, string> = { added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" };
const json = "mt-2 max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5";

function Fields({ values }: { values: Record<string, unknown> }) {
  return <dl className="divide-y text-sm">{Object.entries(values).map(([key, value]) => <div key={key} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-2 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{key}</dt><dd className="break-words tabular-nums">{value === null || value === undefined || value === "" ? "—" : String(value)}</dd></div>)}</dl>;
}

export default async function DinamikItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminDinamikItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const listHref = `/yonetim/tedarikciler/dinamik?brand=${encodeURIComponent(item.list_group)}`;
  return <AdminPage>
    <AdminPageHeader
      breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Dinamik", href: listHref }, { label: item.code }]}
      title={<span className="font-mono">{item.code}</span>}
      description={<>{p.stokAdi || "Yalnız fiyat listesinde — ürün bilgisi yok"} · {item.list_group}<br/>Son görülme: {date(item.last_seen_at)} (İstanbul) · İlk görülme: {date(item.first_seen_at)} · Son değişim: {date(item.changed_at)}</>}
      actions={<StatusBadge tone={item.presence === "present" ? "success" : "warning"}>{item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif — iki başarılı çekimde bulunamadı" : "Son listede bulunamadı"}</StatusBadge>}/>
    <AdminColumns>
      <AdminPanel title="Ürün bilgileri" description="Araç ve grup alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.">
        <Fields values={{ "İngilizce adı": p.ingilizceAdi, "Araç markası (kull1s)": p.kull1s, "Üretici (kull3s)": p.kull3s, "Ürün grubu (kull7s)": p.kull7s, "Ürün tipi (kull8s)": p.kull8s,
          "OEM listesi": p.oemListe, "Eşdeğer listesi": p.esdegerListe, Barkod: [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(", "),
          "Paket / koli": p.paketMiktari !== undefined ? `${p.paketMiktari} / ${p.koliMiktari ?? "—"} ${p.olcuBirimi ?? ""}` : null, Desi: p.desi, Görsel: p.resimUrl }}/>
      </AdminPanel>
      <AdminPanel title="Kaynak fiyat ve stok" description="Fiyatın KDV ve iskonto anlamı doğrulanmadı; ürün mağazada satışa açık değil. Stoklar adet değil VAR/YOK bayrağıdır.">
        <Fields values={{ "Liste fiyatı (₺)": item.price_data?.fiyat ?? "Eksik", "Kampanya oranı": item.price_data?.kampanyaOrani ?? "—",
          "Stok listesindeki fiyat": typeof item.source_variants.stockListPrice === "number" ? `${item.source_variants.stockListPrice} (fiyat listesiyle farklı)` : "Fiyat listesiyle aynı" }}/>
        <Separator className="my-4"/>
        <h3 className="mb-2 text-sm font-medium">Bölge stokları</h3>
        {item.stock_data ? <Fields values={{ ...Object.fromEntries(dinamikRegions.map(region => { const stock = dinamikRegionStock(item.stock_data, region.key); return [`${region.label} (${region.key})`, stock === null ? "Veri yok" : stock ? "Var" : "Yok"]; })), "Kaporta": item.stock_data.kaporta }}/>
          : <p className="text-sm text-muted-foreground">Bu kod yalnız fiyat listesinde; stok listesinde satırı yok.</p>}
      </AdminPanel>
    </AdminColumns>
    <AdminPanel title="Değişiklik geçmişi" description="Son 90 gün içindeki en son 20 değişiklik gösterilir. Değişmeyen çekimler yeni geçmiş satırı oluşturmaz." flush>
      {item.changes.length ? <div className="divide-y">{item.changes.map(change => <Collapsible key={change.id} className="px-4 py-2.5">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-sm"><ChevronRight className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/><span className="tabular-nums">{date(change.changed_at)}</span><StatusBadge tone={change.kind === "added" || change.kind === "restored" ? "success" : change.kind === "changed" ? "info" : "warning"}>{changeKinds[change.kind]}</StatusBadge></CollapsibleTrigger>
        <CollapsibleContent><pre className={json}>{JSON.stringify({ önce: change.before_data, sonra: change.after_data }, null, 2)}</pre></CollapsibleContent>
      </Collapsible>)}</div> : <EmptyState title="Kayıtlı değişiklik yok" icon={<History/>}/>}
    </AdminPanel>
    <AdminPanel title="Veri kontrolü" actions={item.conflicting ? <StatusBadge tone="warning">İnceleme gerekli</StatusBadge> : undefined}>
      <p className="text-sm">Kaynak satır sayısı — fiyat: {item.price_count}, stok: {item.stock_count}.</p>
      <p className="mt-1 text-sm text-muted-foreground">{item.conflicting ? "Aynı kod için farklı yanıtlar veya iki listede farklı fiyat bulundu; farklı kaynak değerleri aşağıda saklanıyor." : "Bu kayıt için çelişkili tekrar bulunmadı."}</p>
      <Collapsible className="mt-3"><CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-medium hover:underline"><ChevronRight className="size-4 transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/>Kaynak alanlarını göster</CollapsibleTrigger>
        <CollapsibleContent><pre className={json}>{JSON.stringify({ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }, null, 2)}</pre></CollapsibleContent></Collapsible>
    </AdminPanel>
  </AdminPage>;
}
