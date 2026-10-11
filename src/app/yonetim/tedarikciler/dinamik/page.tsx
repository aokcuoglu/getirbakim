import Link from "next/link";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { adminDinamikOverview } from "@/modules/admin/data";
import { db } from "@/lib/db";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, EmptyState, Stat, StatGrid, StatusBadge, StatusMessage, TableRegion } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const number = (value: number | null | undefined) => new Intl.NumberFormat("tr-TR").format(value ?? 0);
const time = (value: Date | null | undefined) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz yok";
const runLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };
const runTones: Record<string, "success" | "error" | "warning" | "neutral"> = { succeeded: "success", failed: "error", rejected: "warning", running: "neutral" };
const variables = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"];

export default async function DinamikAdmin() {
  await requireAdmin();
  const status = supplierStatuses().find(s => s.name === "Dinamik");
  const [data, health] = await Promise.all([adminDinamikOverview(), supplierHealth(db, DINAMIK_COMPANY).catch(() => null)]);
  const { items, scopes, runs } = data;
  const tone = !health ? "error" : health.healthy ? "success" : scopes.synced ? "warning" : "neutral";
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Dinamik" }]} title="Dinamik API"
      description="Marka bazlı stok ve fiyat listeleri; her marka ayrı kapsam olarak Başbuğ ile aynı zamanlayıcıda çekilir."
      actions={<StatusBadge tone={tone}>{!health ? "Okunamadı" : health.healthy ? "Sağlıklı" : scopes.synced ? "Dikkat gerekiyor" : "İlk çekim bekleniyor"}</StatusBadge>}/>
    <StatusMessage tone="info">Veriler yalnız tedarikçi kaydı olarak tutulur; mağazada satışa açılmaz. Fiyatın KDV/iskonto anlamı, kampanya oranı ve bölge stok bayrakları (İstanbul, Ankara, Sakarya, Kayseri) doğrulanınca satış adaptörü ayrıca eklenecek.</StatusMessage>
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
  </AdminPage>;
}
