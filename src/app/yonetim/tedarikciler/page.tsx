import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { adminSupplierOverview } from "@/modules/admin/data";
import { db } from "@/lib/db";
import { AdminPage, AdminPageHeader, StatusBadge } from "@/components/admin/ui";

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
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler" }]} title="Tedarikçi entegrasyonları"
      description="Tedarikçi API bağlantılarının durumu, senkronizasyon sağlığı ve çekilen veri hacmi."/>
    <div className="admin-integrations">
      <section className="admin-panel" aria-labelledby="supplier-basbug">
        <header className="admin-integration-head">
          <span className="admin-integration-logo" aria-hidden="true">B</span>
          <div><h2 id="supplier-basbug">Başbuğ API</h2><p>Ürün, NF maliyet, MRK stok ve döviz kuru</p></div>
          <StatusBadge tone={!health ? "error" : healthy ? "success" : "warning"}>{!health ? "Okunamadı" : healthy ? "Sağlıklı" : "Dikkat gerekiyor"}</StatusBadge>
        </header>
        <dl className="admin-facts">
          <div><dt>Güncel ürün</dt><dd>{number(overview.items.present)}<small>{number(overview.items.groups)} liste grubu</small></dd></div>
          <div><dt>Son çekim</dt><dd>{time(last?.started_at)}<small>{last ? `${last.list_group} · ${runLabels[last.status] ?? last.status}` : "Kayıt yok"}</small></dd></div>
          <div><dt>Son 24 saat</dt><dd>{number(overview.runs.total)} çekim<small>{overview.runs.failed ? `${number(overview.runs.failed)} başarısız / inceleme` : "Hatasız"}</small></dd></div>
          <div><dt>Zamanlayıcı</dt><dd>{health?.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok"}<small>{health ? `${health.issues.length} grupta sorun` : "Durum okunamadı"}</small></dd></div>
        </dl>
        <p className="admin-integration-note">{basbug?.message}</p>
        <footer className="admin-panel-footer"><span>{basbug?.configured ? "Bağlantı değişkenleri tanımlı" : "Bağlantı değişkenleri eksik"}</span><Link className="admin-btn-secondary" href="/yonetim/tedarikciler/basbug">Yönet <ArrowRight size={14}/></Link></footer>
      </section>
      <section className="admin-panel" aria-labelledby="supplier-dinamik">
        <header className="admin-integration-head">
          <span className="admin-integration-logo" aria-hidden="true">D</span>
          <div><h2 id="supplier-dinamik">Dinamik API</h2><p>Ürün, fiyat ve stok (sözleşme doğrulanmadı)</p></div>
          <StatusBadge tone={dinamik?.verified ? "success" : dinamik?.configured ? "neutral" : "warning"}>{dinamik?.verified ? "Bağlı" : "Doğrulanmadı"}</StatusBadge>
        </header>
        <dl className="admin-facts">
          <div><dt>Bağlantı değişkenleri</dt><dd>{dinamik?.configured ? "Tanımlı" : "Eksik"}<small>DINAMIK_BASE · APIKEY · SECRETKEY</small></dd></div>
          <div><dt>Senkronizasyon</dt><dd>Kapalı<small>Sözleşme doğrulanana kadar istek yapılmaz</small></dd></div>
        </dl>
        <p className="admin-integration-note">{dinamik?.message}</p>
        <footer className="admin-panel-footer"><span>Erişim IP izin listesine bağlı</span><Link className="admin-btn-secondary" href="/yonetim/tedarikciler/dinamik">Ayrıntılar <ArrowRight size={14}/></Link></footer>
      </section>
    </div>
  </AdminPage>;
}
