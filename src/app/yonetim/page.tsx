import { adminOverview } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import { requireAdmin } from "@/modules/auth/session";
import { SupplierConnections } from "@/components/admin/supplier-connections";
import { approveService } from "@/modules/admin/actions";
import { AdminPage, AdminPageHeader, AdminPanel, AdminColumns, Stat, StatGrid, StatusMessage, EmptyState } from "@/components/admin/ui";

const number = (value: number | string) => new Intl.NumberFormat("tr-TR").format(Number(value));

export default async function Admin({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();
  const {approved,error}=normalizeSearchParams(await searchParams);
  const {counts,accounts}=await adminOverview();
  const pending=accounts.filter(a=>!a.approved);
  return <AdminPage>
    <AdminPageHeader eyebrow="Yönetim" title="Genel bakış" description="Katalog, servis hesapları ve tedarikçi bağlantılarının özeti."/>
    <StatGrid label="Özet">
      <Stat label="Kayıtlı ürün" value={number(counts.products)}/>
      <Stat label="Servis hesabı" value={number(accounts.length)} href="/yonetim/servisler" linkLabel="Servisleri yönet"/>
      <Stat label="Onay bekleyen başvuru" value={number(pending.length)} note={pending.length ? "Aşağıdan onaylayabilirsin" : "Bekleyen başvuru yok"}/>
      <Stat label="Veritabanı" value={counts.database}/>
    </StatGrid>
    {approved && <StatusMessage>Servis başvurusu onaylandı.</StatusMessage>}
    {error && <StatusMessage tone="error">Başvuru onaylanamadı. İndirim %0–50 olmalı; başvuru daha önce onaylanmış olabilir.</StatusMessage>}
    <AdminColumns>
      <AdminPanel title="Onay bekleyen servis başvuruları" description="Onay, servise fiyat ve sepet erişimini hemen açar." actions={<Link className="admin-link" href="/yonetim/servisler">Tüm servisler →</Link>}>
        {pending.length ? <ul className="admin-list">{pending.map(a=><li key={a.id}>
          <h3>{a.name}</h3><p>{a.email}</p>{a.contact_name && <p>{a.contact_name} · {a.phone} · {a.city}</p>}
          <form action={approveService} className="admin-inline-form"><input type="hidden" name="id" value={a.id}/><label>Servise özel indirim (%)<input name="discount" type="number" min={0} max={50} defaultValue={0} required/></label><button>Başvuruyu onayla</button></form>
        </li>)}</ul> : <EmptyState title="Bekleyen başvuru yok"><p>Yeni başvurular burada listelenir.</p></EmptyState>}
      </AdminPanel>
      <AdminPanel title="Tedarikçi bağlantıları" actions={<Link className="admin-link" href="/yonetim/tedarikciler">Tedarikçiler →</Link>}>
        <SupplierConnections/>
      </AdminPanel>
    </AdminColumns>
  </AdminPage>;
}

