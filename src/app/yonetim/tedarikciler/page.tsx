import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { adminSupplierOverview } from "@/modules/admin/data";
import { db } from "@/lib/db";
import type { ReactNode } from "react";
import { AdminPage, AdminPageHeader, ButtonLink, StatusBadge } from "@/components/admin/ui";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const time = (value: Date | null | undefined) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz yok";
const runLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };

export default async function Suppliers() {
  await requireAdmin();
  const company = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const [overview, health] = await Promise.all([adminSupplierOverview(), supplierHealth(db, company).catch(() => null)]);
  const statuses = supplierStatuses();
  const basbug = statuses.find(s => s.name === "Başbuğ");
  const dinamik = statuses.find(s => s.name === "Dinamik");
  const healthy = Boolean(health?.healthy);
  const last = overview.last;
  const card = (props: { id: string; letter: string; title: string; subtitle: string; badge: ReactNode; facts: [string, ReactNode, ReactNode][]; note?: string; footer: string; href: string; action: string }) =>
    <Card className="gap-0 py-0" role="region" aria-labelledby={props.id}>
      <CardHeader className="flex items-center gap-3 border-b py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted font-bold text-muted-foreground" aria-hidden="true">{props.letter}</span>
        <div className="min-w-0 flex-1"><CardTitle><h2 id={props.id}>{props.title}</h2></CardTitle><CardDescription>{props.subtitle}</CardDescription></div>
        {props.badge}
      </CardHeader>
      <dl className="grid grid-cols-2 divide-x border-b lg:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
        {props.facts.map(([label, value, note]) => <div key={label} className="px-4 py-3 [&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0">
          <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}<span className="block text-xs font-normal text-muted-foreground">{note}</span></dd>
        </div>)}
      </dl>
      {props.note && <CardContent className="py-3 text-sm text-muted-foreground">{props.note}</CardContent>}
      <CardFooter className="mt-auto justify-between border-t bg-muted/50 py-3 text-sm text-muted-foreground"><span>{props.footer}</span><ButtonLink href={props.href} size="sm">{props.action}<ArrowRight/></ButtonLink></CardFooter>
    </Card>;
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler" }]} title="Tedarikçi entegrasyonları"
      description="Tedarikçi API bağlantılarının durumu, senkronizasyon sağlığı ve çekilen veri hacmi."/>
    <div className="grid gap-4 lg:grid-cols-2">
      {card({ id: "supplier-basbug", letter: "B", title: "Başbuğ API", subtitle: "Ürün, NF maliyet, MRK stok ve döviz kuru",
        badge: <StatusBadge tone={!health ? "error" : healthy ? "success" : "warning"}>{!health ? "Okunamadı" : healthy ? "Sağlıklı" : "Dikkat gerekiyor"}</StatusBadge>,
        facts: [
          ["Güncel ürün", number(overview.items.present), `${number(overview.items.groups)} liste grubu`],
          ["Son çekim", time(last?.started_at), last ? `${last.list_group} · ${runLabels[last.status] ?? last.status}` : "Kayıt yok"],
          ["Son 24 saat", `${number(overview.runs.total)} çekim`, overview.runs.failed ? `${number(overview.runs.failed)} başarısız / inceleme` : "Hatasız"],
          ["Zamanlayıcı", health?.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok", health ? `${health.issues.length} grupta sorun` : "Durum okunamadı"],
        ], note: basbug?.message, footer: basbug?.configured ? "Bağlantı değişkenleri tanımlı" : "Bağlantı değişkenleri eksik", href: "/yonetim/tedarikciler/basbug", action: "Yönet" })}
      {card({ id: "supplier-dinamik", letter: "D", title: "Dinamik API", subtitle: "Ürün, fiyat ve stok (sözleşme doğrulanmadı)",
        badge: <StatusBadge tone={dinamik?.verified ? "success" : dinamik?.configured ? "neutral" : "warning"}>{dinamik?.verified ? "Bağlı" : "Doğrulanmadı"}</StatusBadge>,
        facts: [
          ["Bağlantı değişkenleri", dinamik?.configured ? "Tanımlı" : "Eksik", "BASE · APIKEY · SECRETKEY"],
          ["Senkronizasyon", "Kapalı", "Sözleşme doğrulanana kadar istek yapılmaz"],
        ], note: dinamik?.message, footer: "Erişim IP izin listesine bağlı", href: "/yonetim/tedarikciler/dinamik", action: "Ayrıntılar" })}
    </div>
  </AdminPage>;
}
