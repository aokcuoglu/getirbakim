import { adminServiceAccounts } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from '@/modules/auth/session';
import { saveService } from '@/modules/admin/commerce-actions';
import { createService } from '@/modules/admin/actions';
import { Building2 } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPanel, AffixInput, EmptyState, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function Services({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();const params=normalizeSearchParams(await searchParams);
  const accounts=await adminServiceAccounts();
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{label:"Yönetim",href:"/yonetim"},{label:"B2B servisler"}]} eyebrow="Satış" title="Servis hesapları ve indirimler" description="Her onaylı servis için satış fiyatına uygulanacak indirim oranını belirle. Değişiklik katalog ve sepete hemen yansır; geçmiş sipariş fiyatları korunur."/>
    {params.created && <StatusMessage>Servis hesabı oluşturuldu.</StatusMessage>}
    {params.saved && <StatusMessage>Servis hesabı kaydedildi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">{params.error === "duplicate" ? "Bu e-posta zaten kayıtlı." : "Bilgileri kontrol et. İndirim %0–50 olmalı; şifre en az 12 karakter ve en fazla 72 UTF-8 bayt olmalı."}</StatusMessage>}
    <AdminPanel title="Mevcut servisler" description={`${accounts.length} hesap · ${accounts.filter(a => !a.approved).length} onay bekliyor`} flush>
      {accounts.length ? <Table><TableHeader><TableRow><TableHead className="pl-4">Servis</TableHead><TableHead>İletişim</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Özel indirim</TableHead><TableHead>Hesap durumu</TableHead><TableHead className="pr-4"><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader><TableBody>
        {accounts.map(a=>{const form=`service-${a.id}`;return <TableRow key={a.id}>
          <TableCell className="pl-4"><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.email}</div></TableCell>
          <TableCell>{a.contact_name ? <><div>{a.contact_name}</div><div className="text-xs text-muted-foreground">{a.phone} · {a.city}</div></> : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell><StatusBadge tone={a.approved ? "success" : "warning"}>{a.approved ? "Onaylı" : "Onay bekliyor"}</StatusBadge></TableCell>
          <TableCell className="text-right"><AffixInput className="ml-auto w-28" suffix="%" form={form} aria-label={`${a.name} indirim oranı`} name="discount" type="number" min={0} max={50} defaultValue={a.discount_percent} required/></TableCell>
          <TableCell><NativeSelect form={form} aria-label={`${a.name} hesap durumu`} name="approved" defaultValue={String(a.approved)}><NativeSelectOption value="true">Onaylı</NativeSelectOption><NativeSelectOption value="false">Pasif / Onay bekliyor</NativeSelectOption></NativeSelect></TableCell>
          <TableCell className="pr-4 text-right"><form id={form} action={saveService}><input type="hidden" name="id" value={a.id}/><Button type="submit" variant="outline" size="sm">Kaydet</Button></form></TableCell>
        </TableRow>;})}
      </TableBody></Table> : <EmptyState title="Henüz servis hesabı yok" icon={<Building2/>}>Aşağıdan ilk servis hesabını oluşturabilirsin.</EmptyState>}
    </AdminPanel>
    <form action={createService}>
      <AdminPanel title="Yeni servis hesabı" description="Oluşturulan hesap onaylı başlar ve fiyat ile sepet erişimi hemen açılır." footer={<><span>Şifre en az 12 karakter olmalı.</span><Button type="submit">Onaylı servis oluştur</Button></>}>
        <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field><FieldLabel htmlFor="service-name">Servis adı</FieldLabel><Input id="service-name" name="name" minLength={2} maxLength={150} required/></Field>
          <Field><FieldLabel htmlFor="service-email">E-posta</FieldLabel><Input id="service-email" type="email" name="email" maxLength={200} required/></Field>
          <Field><FieldLabel htmlFor="service-password">İlk şifre</FieldLabel><Input id="service-password" type="password" name="password" minLength={12} maxLength={72} autoComplete="new-password" required/></Field>
          <Field><FieldLabel htmlFor="service-discount">Özel indirim</FieldLabel><AffixInput suffix="%" id="service-discount" name="discount" type="number" min={0} max={50} defaultValue={0} required/></Field>
        </FieldGroup>
      </AdminPanel>
    </form>
  </AdminPage>;
}
