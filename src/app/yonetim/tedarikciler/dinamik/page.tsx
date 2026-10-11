import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { adminDinamikOverview } from "@/modules/admin/data";
import { adminDinamikItems } from "@/modules/admin/dinamik";
import { dinamikRegion, dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierProductDetails } from "@/components/admin/supplier-product-details";
import { DinamikProductFilters } from "@/components/admin/dinamik-product-filters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { db } from "@/lib/db";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, ButtonLink, EmptyState, PagerLink, Stat, StatGrid, StatusBadge, StatusMessage, TableRegion } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const number = (value: number | null | undefined) => new Intl.NumberFormat("tr-TR").format(value ?? 0);
const time = (value: Date | null | undefined) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz yok";
const runLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };
const runTones: Record<string, "success" | "error" | "warning" | "neutral"> = { succeeded: "success", failed: "error", rejected: "warning", running: "neutral" };
const variables = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"];
const price = (value: number | null | undefined) => value == null ? null : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const filterKeys = ["q", "brand", "group", "region", "stock", "quality", "presence"] as const;

export default async function DinamikAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const status = supplierStatuses().find(s => s.name === "Dinamik");
  const [data, health, list] = await Promise.all([adminDinamikOverview(), supplierHealth(db, DINAMIK_COMPANY).catch(() => null), adminDinamikItems(params)]);
  const { items: rows, total, page, pages } = list;
  const region = dinamikRegion(params.region);
  function pageUrl(target: number) {
    const query = new URLSearchParams({ page: String(target) });
    for (const key of filterKeys) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/dinamik?${query}`;
  }
  const pageNumbers = Array.from(new Set([1, ...Array.from({ length: 5 }, (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i), pages])).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const { items, scopes, runs } = data;
  const tone = !health ? "error" : health.healthy ? "success" : scopes.synced ? "warning" : "neutral";
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Dinamik" }]} title="Dinamik API"
      description="Marka bazlı stok ve fiyat listeleri; her marka ayrı kapsam olarak Başbuğ ile aynı zamanlayıcıda çekilir."
      actions={<StatusBadge tone={tone}>{!health ? "Okunamadı" : health.healthy ? "Sağlıklı" : scopes.synced ? "Dikkat gerekiyor" : "İlk çekim bekleniyor"}</StatusBadge>}/>
    <StatusMessage tone="info">Veriler yalnız tedarikçi kaydı olarak tutulur; mağazada satışa açılmaz. Fiyatın KDV/iskonto anlamı, kampanya oranı ve bölge stok bayrakları (İstanbul, Ankara, Sakarya, Kayseri) doğrulanınca satış adaptörü ayrıca eklenecek.</StatusMessage>
    <SupplierTabs label="Dinamik yönetimi" transfer={<div className="flex flex-col gap-4">
    <StatGrid label="Dinamik özeti">
      <Stat label="Güncel ürün" value={number(items.present)} note={`${number(items.brands)} marka · ${number(items.priced)} fiyatlı`}/>
      <Stat label="Bölgede stokta" value={number(items.available)} note="En az bir depoda VAR (adet değil)"/>
      <Stat label="Markalar" value={`${number(scopes.synced)} / ${number(scopes.enabled)}`} note={data.discovery ? `Liste ${time(data.discovery.checked_at)} okundu · ${number(data.discovery.listed)} marka` : "Marka listesi henüz okunmadı"}
        tone={scopes.failing ? "warning" : scopes.synced === scopes.enabled && scopes.enabled ? "success" : "neutral"}/>
      <Stat label="Son 24 saat" value={`${number(runs.total)} çekim`} note={runs.failed ? `${number(runs.failed)} başarısız / inceleme · ${number(scopes.due)} sırada` : `Hatasız · ${number(scopes.due)} sırada`}
        tone={runs.failed ? "warning" : "success"}/>
    </StatGrid>
    <AdminColumns wide>
      <AdminPanel title="Son çekimler" description={`En eski güncel marka: ${time(scopes.oldest_success)} · en son: ${time(scopes.last_success)}`} flush>
        {data.recent.length ? <TableRegion label="Son Dinamik çekimleri"><Table>
          <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Başlangıç</TableHead><TableHead className="text-right">Ürün</TableHead><TableHead className="text-right">Yeni / değişen</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader>
          <TableBody>{data.recent.map(run => <TableRow key={`${run.list_group}-${run.started_at.toISOString()}`}>
            <TableCell className="font-medium">{run.list_group}</TableCell>
            <TableCell className="tabular-nums">{time(run.started_at)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(run.quality.uniqueProducts)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(run.stats.added)} / {number((run.stats.changed ?? 0) + (run.stats.restored ?? 0))}</TableCell>
            <TableCell><StatusBadge tone={runTones[run.status] ?? "neutral"}>{runLabels[run.status] ?? run.status}</StatusBadge>{run.error_reason && <span className="ml-2 text-xs text-muted-foreground">{run.error_reason}</span>}</TableCell>
          </TableRow>)}</TableBody>
        </Table></TableRegion> : <EmptyState title="Henüz çekim yok">Zamanlayıcı marka listesini okuyup markaları sırayla çeker.</EmptyState>}
      </AdminPanel>
      <div className="flex flex-col gap-4">
        <AdminPanel title="Hata veren markalar" flush>
          {data.failing.length ? <ul className="divide-y text-sm">{data.failing.map(scope => <li key={scope.list_group} className="flex items-start justify-between gap-3 px-4 py-2.5">
            <span><span className="font-medium">{scope.list_group}</span><span className="block text-xs text-muted-foreground">{scope.error_reason ?? "Bilinmeyen hata"}</span></span>
            <span className="text-right text-xs text-muted-foreground tabular-nums">{scope.consecutive_failures}× · sonraki {time(scope.next_run_at)}</span>
          </li>)}</ul> : <p className="px-4 py-3 text-sm text-muted-foreground">Hata veren marka yok.</p>}
        </AdminPanel>
        <AdminPanel title="Ortam değişkenleri" footer={<Link className="font-medium text-primary hover:underline" href="/yonetim/tedarikciler">Tüm tedarikçiler →</Link>}>
          <ul className="divide-y">{variables.map(name => <li key={name} className="flex items-center justify-between py-2.5 first:pt-0"><code className="font-mono text-xs">{name}</code><StatusBadge tone={process.env[name] ? "success" : "warning"}>{process.env[name] ? "Tanımlı" : "Eksik"}</StatusBadge></li>)}</ul>
          <p className="mt-3 text-sm text-muted-foreground">{status?.message}</p>
        </AdminPanel>
      </div>
    </AdminColumns>
    </div>} products={
    <SupplierBrowser><Card className="gap-0 py-0">
      <DinamikProductFilters key={filterKeys.map(key => params[key]).join("|")} params={params} brands={list.brands} groups={list.groups}/>
      <div className="transition-opacity group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-45">
        <div className="flex flex-wrap justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün · {params.brand || "Tüm markalar"}{params.stock && ` · ${region === "any" ? "Herhangi bölge" : dinamikRegions.find(r => r.key === region)?.label}: ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>Fiyat: kaynak liste fiyatı (₺, KDV/iskonto anlamı doğrulanmadı) · Stok: VAR/YOK, adet değil</span></div>
        {rows.length ? <Table className="min-w-[1180px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">Dinamik ürünleri, liste fiyatları ve bölge stok durumları</caption>
          <colgroup><col className="w-[150px]"/><col className="w-[230px]"/><col className="w-[96px]"/><col className="w-[90px]"/><col className="w-[120px]"/><col className="w-[86px]"/><col className="w-[52px]"/>{dinamikRegions.map(r => <col key={r.key} className="w-[58px]"/>)}<col className="w-[96px]"/><col className="w-[34px]"/></colgroup>
          <TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-4">Stok kodu</TableHead><TableHead>Ürün adı</TableHead><TableHead>Marka</TableHead><TableHead>Araç</TableHead><TableHead>Grup</TableHead><TableHead className="text-right" title="Kaynak liste fiyatı (₺)">Fiyat (₺)</TableHead><TableHead className="text-right" title="Kampanya oranı">Kamp.</TableHead>{dinamikRegions.map(r => <TableHead key={r.key} className={cn("text-center", r.key === region && "bg-primary/5")} title={`${r.label} stok durumu (${r.key})`}>{r.short}</TableHead>)}<TableHead>Kontrol</TableHead><TableHead><span className="sr-only">Ürün detayı</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(item => { const p = item.product_data; const href = `/yonetim/tedarikciler/dinamik/urun/${item.id}`; const campaign = Number(item.price_data?.kampanyaOrani ?? 0); return <SupplierProductDetails key={item.id} code={item.code} title={p.stokAdi || "Ürün bilgisi yok"} supplier="Dinamik" detailHref={href}
            fields={[
              ["Marka", item.list_group], ["İngilizce adı", p.ingilizceAdi],
              ["Araç", p.kull1s], ["Üretici", p.kull3s],
              ["Ürün grubu", p.kull7s], ["Ürün tipi", p.kull8s],
              ["OEM listesi", p.oemListe], ["Eşdeğer listesi", p.esdegerListe],
              ["Barkod", [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(" · ")],
              ["Paket / koli", p.paketMiktari !== undefined ? `${p.paketMiktari} / ${p.koliMiktari ?? "—"} ${p.olcuBirimi ?? ""}` : null],
              ["Liste fiyatı (₺)", price(item.price_data?.fiyat) ?? "Fiyat eksik"],
              ["Kampanya oranı", campaign ? `%${number(campaign > 1 ? campaign : campaign * 100)}` : "—"],
              ["Listede bulunma", item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif" : "Listede yok"],
              ["Veri kontrolü", item.conflicting ? "Çelişkili kayıt" : item.price_data?.fiyat == null ? "Fiyat eksik" : !item.stock_data ? "Yalnız fiyat kaydı; stok listesinde yok" : item.price_count > 1 || item.stock_count > 1 ? "Tekrarlanan kod" : "—"],
              ["Kaynak satırları", `${item.price_count} fiyat · ${item.stock_count} stok`],
            ]}
            stockTitle="Bölge stokları" stocks={dinamikRegions.map(region => ({ label: region.label, available: dinamikRegionStock(item.stock_data, region.key) }))}
            footer={<p className="text-xs text-muted-foreground">Fiyat kaynak liste fiyatıdır; KDV ve iskonto anlamı doğrulanmadı. Stoklar adet yerine var/yok bildirir.</p>}>
          <TableRow>
            <TableCell className="pl-4"><DialogTrigger className="block w-full truncate text-left font-mono font-medium text-primary hover:underline" title={item.code} aria-label={`${item.code} ürün ayrıntılarını aç`}>{item.code}</DialogTrigger></TableCell>
            <TableCell className="truncate font-medium" title={p.stokAdi ?? "Yalnız fiyat listesinde; ürün bilgisi yok"}>{p.stokAdi || <span className="font-normal text-muted-foreground">Ürün bilgisi yok</span>}</TableCell>
            <TableCell className="truncate text-muted-foreground" title={item.list_group}>{item.list_group}</TableCell>
            <TableCell className="truncate text-muted-foreground" title={p.kull1s}>{p.kull1s || "—"}</TableCell>
            <TableCell className="truncate text-muted-foreground" title={[p.kull7s, p.kull8s].filter(Boolean).join(" · ")}>{p.kull8s || p.kull7s || "—"}</TableCell>
            <TableCell className="truncate text-right font-semibold tabular-nums">{price(item.price_data?.fiyat) ?? <span className="font-normal text-amber-700 dark:text-amber-400">Eksik</span>}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{campaign ? `%${number(campaign > 1 ? campaign : campaign * 100)}` : "—"}</TableCell>
            {dinamikRegions.map(r => { const stock = dinamikRegionStock(item.stock_data, r.key); return <TableCell key={r.key} className={cn("text-center", r.key === region && "bg-primary/5")}><span className={cn("inline-flex items-center gap-1 whitespace-nowrap", stock === null ? "text-amber-700 dark:text-amber-400" : stock ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} title={stock === null ? `${r.label}: stok listesinde yok` : `${r.label}: ${stock ? "VAR" : "YOK"}`}><span className={cn("size-1.5 shrink-0 rounded-full", stock === null ? "bg-amber-500" : stock ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden="true"/>{stock === null ? "—" : stock ? "Var" : "Yok"}</span></TableCell>; })}
            <TableCell>{item.presence !== "present" ? <StatusBadge tone="warning">{item.presence === "inactive" ? "Pasif" : "Listede yok"}</StatusBadge> : item.conflicting ? <StatusBadge tone="error">Çelişkili</StatusBadge> : item.price_data?.fiyat == null ? <StatusBadge tone="warning">Fiyat eksik</StatusBadge> : !item.stock_data ? <StatusBadge tone="neutral">Yalnız fiyat</StatusBadge> : item.price_count > 1 || item.stock_count > 1 ? <StatusBadge tone="info">Tekrar var</StatusBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="pr-3"><DialogTrigger className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary" aria-label={`${item.code} ürün detayı`} title="Ürün detayını aç"><ArrowUpRight className="size-3.5" aria-hidden="true"/></DialogTrigger></TableCell>
          </TableRow></SupplierProductDetails>; })}</TableBody>
        </Table> : <EmptyState title="Filtrelere uygun ürün bulunamadı." icon={<SearchX/>}>{data.items.present ? "Aramayı veya filtreleri değiştirebilirsiniz." : "Henüz Dinamik verisi çekilmedi; zamanlayıcı markaları sırayla çeker."}</EmptyState>}
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Ürün sayfaları">
          <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
          <div className="flex flex-wrap items-center gap-1">
            <PagerLink href={page > 1 ? pageUrl(page - 1) : null}><ChevronLeft/>Önceki</PagerLink>
            {pageNumbers.map((n, i, ns) => <span key={n} className="flex items-center gap-1">{i > 0 && n - ns[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}<ButtonLink size="sm" variant={n === page ? "default" : "ghost"} href={pageUrl(n)} aria-current={n === page ? "page" : undefined}>{n}</ButtonLink></span>)}
            <PagerLink href={page < pages ? pageUrl(page + 1) : null}>Sonraki<ChevronRight/></PagerLink>
          </div>
          <form action="/yonetim/tedarikciler/dinamik" className="flex items-center gap-2">{filterKeys.filter(key => params[key]).map(key => <input key={key} type="hidden" name={key} value={params[key] || ""}/>)}<label htmlFor="page-jump" className="text-muted-foreground">Sayfaya git</label><Input id="page-jump" className="h-7 w-16" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" size="sm" variant="outline">Git</Button></form>
        </nav>
      </div>
    </Card></SupplierBrowser>
    }/>
  </AdminPage>;
}
