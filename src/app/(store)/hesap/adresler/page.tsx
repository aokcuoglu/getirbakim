import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StoreIcon } from "@/components/site/store-icon";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { currentAccount } from "@/modules/auth/session";
import { loginPath } from "@/modules/auth/return-to";
import { ADDRESS_LIMIT, getAddress, listAddresses, type AccountAddress } from "@/modules/store/account-addresses";
import { composeAddress } from "@/modules/store/tr-address";
import { AddressNoticeScope } from "@/components/address-notice";
import { AddressForm } from "@/components/address-form";
import { Alert } from "@/components/ui/alert";
import { storeErrorBox } from "@/components/store-alert-classes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { makeDefault, removeAddress } from "./actions";
import { storeButton } from "@/components/store-button";
import { cn } from "@/lib/utils";

// Only these fixed texts are shown; the query values themselves never are. The form's own refusals show in the form.
const errors = { missing: "Adres bulunamadı. Sayfayı yenileyip yeniden dene." };
const notices = { saved: "Adres kaydedildi.", removed: "Adres silindi.", default: "Varsayılan adres güncellendi." };
const fixedText = <T extends Record<string, string>>(texts: T, key: string | undefined) => key && Object.hasOwn(texts, key) ? texts[key as keyof T] : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Adreslerim", robots: privatePageRobots };

function DefaultForm({ address, kind, text }: { address: AccountAddress; kind: "delivery" | "invoice"; text: string }) {
  return <form action={makeDefault}><input type="hidden" name="id" value={address.id}/><input type="hidden" name="kind" value={kind}/>
    <Button type="submit" variant="link" className={cn(storeButton({ intent: "link", size: "md" }), "px-0")}>{text}</Button></form>;
}

/** Saved delivery and invoice addresses of an approved account: customer, B2B service or admin (#950, #1254). */
export default async function Addresses({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const account = await currentAccount();
  if (!account?.approved) redirect(loginPath("/hesap/adresler"));
  const params = normalizeSearchParams(await searchParams);
  const editId = params.duzenle && uuid.test(params.duzenle) ? params.duzenle : null;
  const [addresses, editing] = await Promise.all([listAddresses(account.id), editId ? getAddress(account.id, editId) : null]);
  const full = addresses.length >= ADDRESS_LIMIT;
  const notice = fixedText(notices, (["saved", "removed", "default"] as const).find(key => params[key]));
  const error = params.error ? fixedText(errors, params.error) ?? errors.missing : null;
  const deleting = params.sil && uuid.test(params.sil) ? params.sil : null;
  return <section className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
    <nav aria-label="Sayfa yolu" className="mb-7 flex flex-wrap items-center gap-[9px] text-[13px] leading-5 wrap-anywhere text-muted-foreground"><Link href="/" className="inline-flex min-h-8 items-center underline-offset-4 hover:text-primary hover:underline">Ana sayfa</Link><StoreIcon name="chevron-right" className="size-[13px]"/><span aria-current="page">Adreslerim</span></nav>
    <AddressNoticeScope notice={notice} noticeId={randomUUID()}>
    <div className="mx-auto grid max-w-[1120px] grid-cols-[minmax(0,1fr)_440px] gap-[56px] max-[1000px]:grid-cols-2 max-[1000px]:gap-[32px] max-[600px]:grid-cols-1 max-[600px]:gap-6">
      <div className="min-w-0">
        <span className="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]">GETİRBAKİM HESABIM</span>
        <h1 className="mb-3 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Adreslerim</h1>
        <p className="mb-6 text-base leading-6 text-muted-foreground">Teslimat ve fatura adreslerini kaydet; varsayılan adreslerin sipariş formunu doldurur.<span className="mt-1 block text-sm tabular-nums">Kayıtlı adres: {addresses.length}/{ADDRESS_LIMIT}</span></p>
        {error && <Alert role="alert" className={cn(storeErrorBox, "mb-4")}>{error}</Alert>}
        {addresses.length ? <ul className="grid gap-4">{addresses.map(address => <li key={address.id}>
          <Card id={`adres-${address.id}`} className="scroll-mt-6 gap-2 rounded-2xl border border-border bg-white p-5 ring-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-lg leading-7 font-semibold wrap-anywhere">{address.label}</h2>
              {address.default_delivery && <Badge variant="info"><StoreIcon name="circle-check" data-icon="inline-start"/>Varsayılan teslimat</Badge>}
              {address.default_invoice && <Badge variant="info"><StoreIcon name="circle-check" data-icon="inline-start"/>Varsayılan fatura</Badge>}
            </div>
            <p className="text-sm leading-5 wrap-anywhere">{address.recipient_name} · <span className="tabular-nums">{address.phone}</span></p>
            <p className="flex gap-2 text-sm leading-5 wrap-anywhere text-muted-foreground"><StoreIcon name="map-pin" className="mt-0.5 size-4 shrink-0"/>{composeAddress({ line: address.address_line, district: address.district, province: address.province, postalCode: address.postal_code })}</p>
            <div className="flex flex-wrap items-center gap-x-5">
              <Link href={`/hesap/adresler?duzenle=${address.id}#adres-formu`} className="inline-flex min-h-11 items-center text-sm leading-5 text-primary underline-offset-4 hover:underline">Düzenle</Link>
              {!address.default_delivery && <DefaultForm address={address} kind="delivery" text="Teslimat için varsayılan yap"/>}
              {!address.default_invoice && <DefaultForm address={address} kind="invoice" text="Fatura için varsayılan yap"/>}
              {deleting !== address.id && <Link href={`/hesap/adresler?sil=${address.id}#adres-${address.id}`} aria-label={`${address.label} adresini sil`}
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-sm leading-5 text-muted-foreground hover:text-destructive"><StoreIcon name="trash-2" className="size-[18px]"/>Sil</Link>}
            </div>
            {deleting === address.id && <div className="grid gap-2 border-t border-border pt-3">
              <p className="text-sm leading-5 font-medium">“{address.label}” silinsin mi?{(address.default_delivery || address.default_invoice) &&
                <span className="block font-normal text-muted-foreground">Bu adres varsayılan {[address.default_delivery && "teslimat", address.default_invoice && "fatura"].filter(Boolean).join(" ve ")} adresin; silinirse yerine başka adres atanmaz.</span>}</p>
              <div className="flex flex-wrap items-center gap-x-5">
                <form action={removeAddress}><input type="hidden" name="id" value={address.id}/>
                  <Button type="submit" variant="destructive" className={storeButton({ intent: "danger", size: "md" })}>Evet, sil</Button></form>
                <Link href={`/hesap/adresler#adres-${address.id}`} className="inline-flex min-h-11 items-center text-sm leading-5 text-primary underline-offset-4 hover:underline">Vazgeç</Link>
              </div>
            </div>}
          </Card></li>)}</ul>
          : <Empty className="items-start gap-2 rounded-2xl border border-dashed border-border p-6 text-left"><StoreIcon name="map-pin" className="size-6 text-muted-foreground"/><p className="text-base leading-6 font-medium">Henüz kayıtlı adresin yok.</p><p className="text-sm leading-5 text-muted-foreground">İlk adresin varsayılan teslimat ve fatura adresin olur.</p></Empty>}
      </div>
      <Card id="adres-formu" className="scroll-mt-6 gap-0 self-start rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5">
        <h2 className="mb-4 text-[23px] leading-[34px] font-semibold">{editing ? "Adresi düzenle" : "Yeni adres ekle"}</h2>
        {/* A fresh key per page render: after a save or any navigation the form starts again without the last refusal. */}
        {editing || !full ? <AddressForm key={randomUUID()} address={editing} first={!addresses.length}/>
          : <Alert className="rounded-md border-0 bg-[#eef7fd] p-3.5 text-sm leading-5">En çok {ADDRESS_LIMIT} adres kaydedebilirsin. Yeni adres eklemek için önce bir adresini sil ya da var olan bir adresi düzenle.</Alert>}
      </Card>
    </div>
    </AddressNoticeScope>
  </section>;
}
