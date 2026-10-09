import { adminServiceAccounts } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from '@/modules/auth/session';
import { saveService } from '@/modules/admin/commerce-actions';
import { createService } from '@/modules/admin/actions';
import { AdminPage, AdminPageHeader, AdminPanel, EmptyState, StatusBadge, StatusMessage, TableRegion } from "@/components/admin/ui";

export default async function Services({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();const params=normalizeSearchParams(await searchParams);
  const accounts=await adminServiceAccounts();
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{label:"Yönetim",href:"/yonetim"},{label:"B2B servisler"}]} eyebrow="Satış" title="Servis hesapları ve indirimler" description="Her onaylı servis için satış fiyatına uygulanacak indirim oranını belirle. Değişiklik katalog ve sepete hemen yansır; geçmiş sipariş fiyatları korunur."/>
    {params.created && <StatusMessage>Servis hesabı oluşturuldu.</StatusMessage>}
    {params.saved && <StatusMessage>Servis hesabı kaydedildi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">{params.error === "duplicate" ? "Bu e-posta zaten kayıtlı." : "Bilgileri kontrol et. İndirim %0–50 olmalı; şifre en az 12 karakter ve en fazla 72 UTF-8 bayt olmalı."}</StatusMessage>}
    <AdminPanel title={`Mevcut servisler (${accounts.length})`}>
      {accounts.length ? <TableRegion label="Servis hesapları"><table className="admin-table"><thead><tr><th>Servis</th><th>İletişim</th><th>Durum</th><th className="num">Özel indirim (%)</th><th>Hesap durumu</th><th><span className="sr-only">İşlem</span></th></tr></thead><tbody>
        {accounts.map(a=>{const form=`service-${a.id}`;return <tr key={a.id}>
          <td><strong>{a.name}</strong><small>{a.email}</small></td>
          <td>{a.contact_name ? <>{a.contact_name}<small>{a.phone} · {a.city}</small></> : <small>—</small>}</td>
          <td><StatusBadge tone={a.approved ? "success" : "warning"}>{a.approved ? "Onaylı" : "Onay bekliyor"}</StatusBadge></td>
          <td className="num"><input form={form} className="admin-cell-input" aria-label={`${a.name} indirim oranı`} name="discount" type="number" min={0} max={50} defaultValue={a.discount_percent} required/></td>
          <td><select form={form} className="admin-cell-input" aria-label={`${a.name} hesap durumu`} name="approved" defaultValue={String(a.approved)}><option value="true">Onaylı</option><option value="false">Pasif / Onay bekliyor</option></select></td>
          <td><form id={form} action={saveService}><input type="hidden" name="id" value={a.id}/><button className="admin-cell-button">Kaydet</button></form></td>
        </tr>;})}
      </tbody></table></TableRegion> : <EmptyState title="Henüz servis hesabı yok"/>}
    </AdminPanel>
    <AdminPanel title="Yeni servis hesabı" description="Oluşturulan hesap onaylı başlar ve fiyat ile sepet erişimi hemen açılır.">
      <form action={createService} className="admin-form"><div className="admin-form-row">
        <label>Servis adı<input name="name" minLength={2} maxLength={150} required/></label>
        <label>E-posta<input type="email" name="email" maxLength={200} required/></label>
        <label>İlk şifre<input type="password" name="password" minLength={12} maxLength={72} autoComplete="new-password" required/></label>
        <label>Özel indirim (%)<input name="discount" type="number" min={0} max={50} defaultValue={0} required/></label>
      </div><button>Onaylı servis oluştur</button></form>
    </AdminPanel>
  </AdminPage>;
}
