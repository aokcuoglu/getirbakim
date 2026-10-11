import Link from "next/link";
import { randomUUID } from "node:crypto";
import { Check, LockKeyhole } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { currentAccount } from "@/modules/auth/session";
import { cartFor, currentCartOwner } from "@/modules/store/cart";
import { cartQuote, orderTotals, shippingRule } from "@/modules/store/orders";
import { paymentsEnabled } from "@/modules/payments/checkout";
import { OrderSummary } from "@/components/order-summary";
import { CheckoutForm } from "@/components/checkout-form";
import { money } from "@/modules/store/catalog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const errors:Record<string,string>={supplier:"Tedarikçi fiyat ve stok bilgisi şu anda doğrulanamadı. Biraz sonra yeniden dene.",stock:"Ürün fiyatı veya stok durumu uygun değil. Sepetini kontrol edip güncelle.",price:"Fiyatlar, servis indirimi veya sipariş veri kaynağı değişti. Güncel toplamı kontrol ederek siparişini tekrar onayla.",validation:"İletişim ve teslimat bilgilerini tamamla; sözleşmeleri onayla.",session:"Sepet oturumu sona erdi.",payment:"Online ödeme şu anda kapalı. Lütfen daha sonra tekrar dene."};

const alert="mb-4 rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]";
const label="gap-1 text-sm leading-5 font-normal";
const control="h-[52px] rounded-[5px] bg-white px-3.5 py-3 text-sm md:text-sm user-invalid:border-destructive";
const textarea="field-sizing-fixed resize-y rounded-[5px] bg-white px-3.5 py-3 text-sm md:text-sm user-invalid:border-destructive";
const step="flex items-center gap-2 whitespace-nowrap not-last:after:ml-1 not-last:after:h-px not-last:after:w-[30px] not-last:after:bg-[#dfe3e8] not-last:after:content-[''] max-[760px]:not-last:after:w-4";
const stepMark="grid size-8 place-items-center rounded-full border border-input";
const required=<span className="text-[#ba3c28]" aria-hidden>*</span>;

export default async function Checkout({searchParams}:{searchParams:Promise<SearchParams>}) {
  const [account,owner,params]=await Promise.all([currentAccount(),currentCartOwner(),searchParams.then(normalizeSearchParams)]);
  const [items,shipping]=await Promise.all([cartFor(owner),shippingRule()]);
  const discount=account?.approved && account.role==="service" ? account.discount_percent : 0;
  const enabled=paymentsEnabled();
  const valid=enabled && items.length>0 && items.every(p=>p.available && p.price_kurus && p.quantity<=p.max_quantity);
  return <div className="bg-[#f8f9f9] text-foreground"><section className="mx-auto min-h-[550px] w-full max-w-[1350px] px-[15px] pb-12 max-[760px]:px-3">
    <div className="flex items-center justify-between gap-6 py-9 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5 max-[760px]:py-7"><h1 className="m-0 text-[28px] leading-9 font-semibold tracking-[-0.7px]">Siparişi tamamla</h1>
      <ol className="m-0 flex list-none items-center gap-6 p-0 text-[13px] leading-5 max-[760px]:gap-3 max-[760px]:text-xs">
        <li className={step}><Link href="/sepet" className="flex items-center gap-2 hover:text-primary"><span className={cn(stepMark,"border-[#73a985] bg-[#f1f8f3] text-[#168657]")}><Check className="size-4" aria-hidden/></span>Sepet</Link></li>
        <li className={step} aria-current="step"><span className={cn(stepMark,"border-primary text-primary")}>1</span>Teslimat</li>
        <li className={step}><span className={stepMark}>2</span>Ödeme</li>
      </ol></div>
    {params.error && <Alert className={alert}>{errors[params.error]??errors.stock}</Alert>}
    {!enabled && !params.error && items.length>0 && <Alert className={alert}>{errors.payment}</Alert>}
    {items.length ? <div className="grid grid-cols-[minmax(0,1.76fr)_minmax(320px,1fr)] items-start gap-4 max-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] max-[760px]:grid-cols-1">
      <Card className="gap-0 rounded-[10px] p-5 ring-0 border border-border max-[760px]:px-4"><h2 className="mb-2 text-xl leading-7 font-semibold tracking-[-0.5px]">Müşteri ve teslimat bilgileri</h2><p className="mb-7 text-sm text-muted-foreground">{discount ? `${account!.name} · %${discount} servis indirimi uygulanıyor.` : "Üye olmadan sipariş verebilirsin."}</p>
      <CheckoutForm disabled={!valid} total={money(orderTotals(items,discount,shipping).total)} errors={errors}><input type="hidden" name="requestKey" value={randomUUID()}/><input type="hidden" name="quote" value={cartQuote(items,discount,shipping)}/>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-name" className={label}>Ad soyad / Firma {required}</FieldLabel><Input id="checkout-name" className={control} name="name" autoComplete="name" minLength={2} maxLength={150} defaultValue={account?.name} required/></Field>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-email" className={label}>E-posta {required}</FieldLabel><Input id="checkout-email" className={control} type="email" name="email" autoComplete="email" maxLength={200} defaultValue={account?.email} required/></Field>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-phone" className={label}>Telefon {required}</FieldLabel><Input id="checkout-phone" className={control} type="tel" name="phone" autoComplete="tel" minLength={10} maxLength={20} required/></Field>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-address" className={label}>Teslimat adresi {required}</FieldLabel><Textarea id="checkout-address" className={cn(textarea,"min-h-24")} name="address" autoComplete="street-address" minLength={15} maxLength={1000} rows={3} required/></Field>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-note" className={label}>Sipariş notu</FieldLabel><Textarea id="checkout-note" className={cn(textarea,"min-h-20")} name="note" maxLength={1000} rows={2}/></Field>
        <Field orientation="horizontal" className="items-start gap-2.5"><Checkbox id="checkout-consent" name="consent" required className="my-0.5 size-5"/><FieldLabel htmlFor="checkout-consent" className="block text-sm leading-[22px] font-normal"><Link href="/on-bilgilendirme-formu" target="_blank" className="hover:text-primary hover:underline">Ön bilgilendirme formunu</Link> ve <Link href="/mesafeli-satis-sozlesmesi" target="_blank" className="hover:text-primary hover:underline">mesafeli satış sözleşmesini</Link> okudum, onaylıyorum. Ödemenin TAMI güvenli ödeme sayfasında alınacağını; tedarikçi stoku teyit edilemezse siparişin iptal edilip ödemenin iade edileceğini biliyorum.</FieldLabel></Field>
      </CheckoutForm><p className="mt-[18px] mb-6 flex flex-wrap items-center gap-1.5 text-xs leading-[18px] text-muted-foreground"><LockKeyhole className="size-[15px]" aria-hidden/>Bilgilerin yalnız sipariş işlemleri için kullanılır. <Link href="/gizlilik-politikasi" className="text-[#0065a5] hover:underline">Gizlilik politikası</Link></p><Link href="/sepet" className="hover:text-primary">← Sepete dön</Link></Card><OrderSummary items={items} discount={discount} shipping={shipping} checkout/></div>
    : <Empty className="gap-6 rounded-none border-0 px-4 py-16"><h2 className="m-0 text-2xl leading-[34px] font-semibold">Sepetin henüz boş.</h2><Button nativeButton={false} className="h-auto min-h-12 gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5 font-semibold hover:bg-brand-strong" render={<Link href="/katalog"/>}>Alışverişe başla</Button></Empty>}
  </section></div>;
}
