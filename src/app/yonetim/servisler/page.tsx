import { adminServiceAccounts } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from '@/modules/auth/session';
import { saveService } from '@/modules/admin/commerce-actions';
import { createService } from '@/modules/admin/actions';
import Link from "next/link";
import { Building2, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function Services({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();const params=normalizeSearchParams(await searchParams);
  const accounts=await adminServiceAccounts();
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>B2B servisler</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <h1 className="text-2xl font-semibold tracking-tight">Servis hesapları ve indirimler</h1>
      <p className="max-w-3xl text-muted-foreground">Her onaylı servis için satış fiyatına uygulanacak indirim oranını belirle. Değişiklik katalog ve sepete hemen yansır; geçmiş sipariş fiyatları korunur.</p>
    </div>
    {params.created && <Alert role="status"><CircleCheck/><AlertDescription>Servis hesabı oluşturuldu.</AlertDescription></Alert>}
    {params.saved && <Alert role="status"><CircleCheck/><AlertDescription>Servis hesabı kaydedildi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive"><CircleAlert/><AlertDescription>{params.error === "duplicate" ? "Bu e-posta zaten kayıtlı." : "Bilgileri kontrol et. İndirim %0–50 olmalı; şifre en az 12 karakter ve en fazla 72 UTF-8 bayt olmalı."}</AlertDescription></Alert>}
    <Card>
      <CardHeader>
        <CardTitle>Mevcut servisler</CardTitle>
        <CardDescription>{accounts.length} hesap · {accounts.filter(a => !a.approved).length} onay bekliyor</CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length ? <Table><TableHeader><TableRow><TableHead>Servis</TableHead><TableHead>İletişim</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Özel indirim</TableHead><TableHead>Hesap durumu</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader><TableBody>
          {accounts.map(a=>{const form=`service-${a.id}`;return <TableRow key={a.id}>
            <TableCell><div className="font-medium">{a.name}</div><div className="text-muted-foreground">{a.email}</div></TableCell>
            <TableCell>{a.contact_name ? <><div>{a.contact_name}</div><div className="text-muted-foreground">{a.phone} · {a.city}</div></> : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell>{a.approved ? <Badge variant="secondary"><CircleCheck data-icon="inline-start"/>Onaylı</Badge> : <Badge variant="outline"><TriangleAlert data-icon="inline-start"/>Onay bekliyor</Badge>}</TableCell>
            <TableCell className="text-right"><InputGroup className="ml-auto w-28">
              <InputGroupInput className="text-right tabular-nums" form={form} aria-label={`${a.name} indirim oranı`} name="discount" type="number" min={0} max={50} defaultValue={a.discount_percent} required/>
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup></TableCell>
            <TableCell><NativeSelect form={form} aria-label={`${a.name} hesap durumu`} name="approved" defaultValue={String(a.approved)}><NativeSelectOption value="true">Onaylı</NativeSelectOption><NativeSelectOption value="false">Pasif / Onay bekliyor</NativeSelectOption></NativeSelect></TableCell>
            <TableCell className="text-right"><form id={form} action={saveService}><input type="hidden" name="id" value={a.id}/><Button type="submit" variant="outline" size="sm">Kaydet</Button></form></TableCell>
          </TableRow>;})}
        </TableBody></Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Building2/></EmptyMedia>
            <EmptyTitle>Henüz servis hesabı yok</EmptyTitle>
            <EmptyDescription>Aşağıdan ilk servis hesabını oluşturabilirsin.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
      </CardContent>
    </Card>
    <form action={createService}>
      <Card>
        <CardHeader>
          <CardTitle>Yeni servis hesabı</CardTitle>
          <CardDescription>Oluşturulan hesap onaylı başlar ve fiyat ile sepet erişimi hemen açılır.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field><FieldLabel htmlFor="service-name">Servis adı</FieldLabel><Input id="service-name" name="name" minLength={2} maxLength={150} required/></Field>
            <Field><FieldLabel htmlFor="service-email">E-posta</FieldLabel><Input id="service-email" type="email" name="email" maxLength={200} required/></Field>
            <Field><FieldLabel htmlFor="service-password">İlk şifre</FieldLabel><Input id="service-password" type="password" name="password" minLength={12} maxLength={72} autoComplete="new-password" required/></Field>
            <Field><FieldLabel htmlFor="service-discount">Özel indirim</FieldLabel><InputGroup>
              <InputGroupInput className="text-right tabular-nums" id="service-discount" name="discount" type="number" min={0} max={50} defaultValue={0} required/>
              <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
            </InputGroup></Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3">
          <span className="text-muted-foreground">Şifre en az 12 karakter olmalı.</span>
          <Button type="submit">Onaylı servis oluştur</Button>
        </CardFooter>
      </Card>
    </form>
  </div>;
}
