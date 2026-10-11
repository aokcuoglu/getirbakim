import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { adminDinamikOverview, adminSetaOverview, adminSupplierOverview } from "@/modules/admin/data";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { db } from "@/lib/db";
import { setaCompany } from "@/modules/suppliers/storefront-sources";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const time = (value: Date | null | undefined) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz yok";
const statusBadge = (tone: "success" | "warning" | "error" | "neutral", text: string) => tone === "success" ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "error" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge> : <Badge variant="outline">{text}</Badge>;
const runLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };

export default async function Suppliers() {
  await requireAdmin();
  const company = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const [overview, health, dinamikData, dinamikHealth, seta, setaHealth] = await Promise.all([adminSupplierOverview(), supplierHealth(db, company).catch(() => null),
    adminDinamikOverview(), supplierHealth(db, DINAMIK_COMPANY).catch(() => null), adminSetaOverview(), supplierHealth(db, setaCompany).catch(() => null)]);
  const statuses = supplierStatuses();
  const basbug = statuses.find(s => s.name === "Başbuğ");
  const dinamik = statuses.find(s => s.name === "Dinamik");
  const setaStatus = statuses.find(s => s.name === "SETA");
  const healthy = Boolean(health?.healthy);
  const last = overview.last;
  const card = (props: { id: string; letter: string; title: string; subtitle: string; badge: ReactNode; facts: [string, ReactNode, ReactNode][]; note?: string; footer: string; href: string; action: string }) =>
    <Card role="region" aria-labelledby={props.id}>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-3"><Avatar aria-hidden="true"><AvatarFallback>{props.letter}</AvatarFallback></Avatar><h2 id={props.id}>{props.title}</h2></CardTitle>
        <CardDescription>{props.subtitle}</CardDescription>
        <CardAction>{props.badge}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {props.facts.map(([label, value, note]) => <div key={label} className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd><dd className="text-muted-foreground">{note}</dd>
          </div>)}
        </dl>
        {props.note && <p className="text-muted-foreground">{props.note}</p>}
      </CardContent>
      <CardFooter className="justify-between gap-2"><span className="text-muted-foreground">{props.footer}</span><Button variant="outline" nativeButton={false} render={<Link href={props.href}/>}>{props.action}<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button></CardFooter>
    </Card>;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Tedarikçiler</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <h1 className="text-2xl font-semibold tracking-tight">Tedarikçi entegrasyonları</h1>
      <p className="text-muted-foreground">Tedarikçi API bağlantılarının durumu, senkronizasyon sağlığı ve çekilen veri hacmi.</p>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      {card({ id: "supplier-basbug", letter: "B", title: "Başbuğ API", subtitle: "Ürün, NF maliyet, MRK stok ve döviz kuru",
        badge: statusBadge(!health ? "error" : healthy ? "success" : "warning", !health ? "Okunamadı" : healthy ? "Sağlıklı" : "Dikkat gerekiyor"),
        facts: [
          ["Güncel ürün", number(overview.items.present), `${number(overview.items.groups)} liste grubu`],
          ["Son çekim", time(last?.started_at), last ? `${last.list_group} · ${runLabels[last.status] ?? last.status}` : "Kayıt yok"],
          ["Son 24 saat", `${number(overview.runs.total)} çekim`, overview.runs.failed ? `${number(overview.runs.failed)} başarısız / inceleme` : "Hatasız"],
          ["Zamanlayıcı", health?.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok", health ? `${health.issues.length} grupta sorun` : "Durum okunamadı"],
        ], note: basbug?.message, footer: basbug?.configured ? "Bağlantı değişkenleri tanımlı" : "Bağlantı değişkenleri eksik", href: "/yonetim/tedarikciler/basbug", action: "Yönet" })}
      {card({ id: "supplier-dinamik", letter: "D", title: "Dinamik API", subtitle: "Marka bazlı ürün, fiyat ve bölge stok listeleri",
        badge: statusBadge(!dinamikHealth ? "error" : dinamikHealth.healthy ? "success" : dinamikData.scopes.synced ? "warning" : "neutral", !dinamikHealth ? "Okunamadı" : dinamikHealth.healthy ? "Sağlıklı" : dinamikData.scopes.synced ? "Dikkat gerekiyor" : "İlk çekim bekleniyor"),
        facts: [
          ["Güncel ürün", number(dinamikData.items.present), `${number(dinamikData.items.brands)} marka`],
          ["Son başarılı", time(dinamikData.scopes.last_success), `${number(dinamikData.scopes.synced)} / ${number(dinamikData.scopes.enabled)} marka güncel`],
          ["Son 24 saat", `${number(dinamikData.runs.total)} çekim`, dinamikData.runs.failed ? `${number(dinamikData.runs.failed)} başarısız / inceleme` : "Hatasız"],
          ["Hata veren", number(dinamikData.scopes.failing), "marka"],
        ], note: dinamik?.message, footer: dinamik?.configured ? "Erişim VPS IP iznine bağlı" : "Bağlantı değişkenleri eksik", href: "/yonetim/tedarikciler/dinamik", action: "Yönet" })}
      {card({ id: "supplier-seta", letter: "S", title: "SETA API", subtitle: "Filtre ürünleri, OEM, KDV hariç bayi fiyatı ve stok durumu",
        badge: statusBadge(!setaStatus?.configured ? "warning" : !setaHealth?.scopes.length ? "neutral" : setaHealth.healthy ? "success" : "warning", !setaStatus?.configured ? "Anahtar eksik" : !setaHealth?.scopes.length ? "Henüz aktarılmadı" : setaHealth.healthy ? "Sağlıklı" : "Dikkat gerekiyor"),
        facts: [
          ["Güncel ürün", number(seta.present), `${number(seta.saleable)} satışta`],
          ["Son çekim", time(seta.last?.started_at), seta.last ? runLabels[seta.last.status] ?? seta.last.status : "Kayıt yok"],
        ], note: setaStatus?.message, footer: setaStatus?.configured ? "SETA_API_KEY tanımlı" : "SETA_API_KEY eksik", href: "/yonetim/tedarikciler/seta", action: "Yönet" })}
    </div>
  </div>;
}
