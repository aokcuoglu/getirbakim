import Link from "next/link";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";

// Only reports what the server can know without calling the API: the client fails closed until the contract is verified.
const variables = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"];

export default async function DinamikAdmin() {
  await requireAdmin();
  const status = supplierStatuses().find(s => s.name === "Dinamik");
  const steps = [
    { title: "Bağlantı değişkenleri", note: "Sunucu ortamında tanımlı olmalı; değerler burada gösterilmez.", state: status?.configured ? "done" : "missing" },
    { title: "IP erişim izni", note: "Dokümantasyon isteği 401 döndü: sunucu IP adresinin Dinamik tarafında izin listesine eklenmesi gerekiyor.", state: status?.verified ? "done" : "missing" },
    { title: "Ürün sözleşmesi ve canlı yanıt", note: "Kimlik doğrulama, yol ve fiyat alanları canlı yanıtla doğrulanmadan veri çekilmez.", state: status?.verified ? "done" : "pending" },
    { title: "Senkronizasyon zamanlaması", note: "Sözleşme doğrulandıktan sonra Başbuğ ile aynı zamanlayıcıya eklenir.", state: "pending" },
  ] as const;
  const icons = { done: <CheckCircle2/>, missing: <XCircle/>, pending: <CircleDashed/> };
  const tones = { done: "bg-success/10 text-success", missing: "bg-destructive/10 text-destructive", pending: "bg-muted text-muted-foreground" } as const;
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Dinamik" }]} title="Dinamik API"
      description="Dinamik tedarikçi entegrasyonunun kurulum durumu." actions={<StatusBadge tone={status?.verified ? "success" : "neutral"}>{status?.verified ? "Bağlı" : "Doğrulanmadı"}</StatusBadge>}/>
    {!status?.verified && <StatusMessage tone="info">Entegrasyon güvenli modda kapalı: servis sözleşmesi doğrulanana kadar tahmini istek, fiyat eşlemesi veya örnek veri kullanılmaz.</StatusMessage>}
    <AdminColumns wide>
      <AdminPanel title="Kurulum adımları" flush>
        <ItemGroup className="gap-0!">{steps.map(step => <Item key={step.title} className="rounded-none border-0 px-4 py-3 [&+&]:border-t">
          <ItemMedia variant="icon" className={cn("rounded-md", tones[step.state])}>{icons[step.state]}</ItemMedia>
          <ItemContent><ItemTitle>{step.title}</ItemTitle><ItemDescription>{step.note}</ItemDescription></ItemContent>
          <ItemActions><StatusBadge tone={step.state === "done" ? "success" : step.state === "missing" ? "error" : "neutral"}>{step.state === "done" ? "Tamam" : step.state === "missing" ? "Eksik" : "Bekliyor"}</StatusBadge></ItemActions>
        </Item>)}</ItemGroup>
      </AdminPanel>
      <AdminPanel title="Ortam değişkenleri" footer={<Link className="font-medium text-primary hover:underline" href="/yonetim/tedarikciler/basbug">Çalışan entegrasyon örneği: Başbuğ →</Link>}>
        <ul className="divide-y">{variables.map(name => <li key={name} className="flex items-center justify-between py-2.5 first:pt-0"><code className="font-mono text-xs">{name}</code><StatusBadge tone={process.env[name] ? "success" : "warning"}>{process.env[name] ? "Tanımlı" : "Eksik"}</StatusBadge></li>)}</ul>
        <p className="mt-3 text-sm text-muted-foreground">Son not: {status?.message}</p>
      </AdminPanel>
    </AdminColumns>
  </AdminPage>;
}
