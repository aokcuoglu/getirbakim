import Link from "next/link";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { AdminPage, AdminPageHeader, AdminPanel, StatusBadge, StatusMessage } from "@/components/admin/ui";

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
  const icons = { done: <CheckCircle2 size={16}/>, missing: <XCircle size={16}/>, pending: <CircleDashed size={16}/> };
  const tones = { done: "success", missing: "danger", pending: "" } as const;
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Dinamik" }]} title="Dinamik API"
      description="Dinamik tedarikçi entegrasyonunun kurulum durumu." actions={<StatusBadge tone={status?.verified ? "success" : "neutral"}>{status?.verified ? "Bağlı" : "Doğrulanmadı"}</StatusBadge>}/>
    {!status?.verified && <StatusMessage tone="info">Entegrasyon güvenli modda kapalı: servis sözleşmesi doğrulanana kadar tahmini istek, fiyat eşlemesi veya örnek veri kullanılmaz.</StatusMessage>}
    <div className="admin-grid-main">
      <AdminPanel title="Kurulum adımları" flush>
        <ul className="admin-actions-list">{steps.map(step => <li key={step.title}><div className="admin-action-static">
          <span className={`admin-action-icon${tones[step.state] ? ` is-${tones[step.state]}` : ""}`}>{icons[step.state]}</span>
          <div><strong>{step.title}</strong><small>{step.note}</small></div>
          <StatusBadge tone={step.state === "done" ? "success" : step.state === "missing" ? "error" : "neutral"}>{step.state === "done" ? "Tamam" : step.state === "missing" ? "Eksik" : "Bekliyor"}</StatusBadge>
        </div></li>)}</ul>
      </AdminPanel>
      <AdminPanel title="Ortam değişkenleri">
        <ul className="admin-list">{variables.map(name => <li key={name} className="admin-row"><code>{name}</code><StatusBadge tone={process.env[name] ? "success" : "warning"}>{process.env[name] ? "Tanımlı" : "Eksik"}</StatusBadge></li>)}</ul>
        <p className="admin-hint" style={{ marginTop: 12 }}>Son not: {status?.message}</p>
        <p className="admin-hint" style={{ marginTop: 8 }}><Link className="admin-link" href="/yonetim/tedarikciler/basbug">Çalışan entegrasyon örneği: Başbuğ →</Link></p>
      </AdminPanel>
    </div>
  </AdminPage>;
}
