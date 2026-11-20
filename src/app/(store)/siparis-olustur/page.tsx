import type { Metadata } from "next";
import { privatePageRobots } from "@/modules/seo/crawlers";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { LockKeyhole } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { currentAccount } from "@/modules/auth/session";
import { cartFor, currentCartOwner } from "@/modules/store/cart";
import { shownProductName } from "@/modules/store/product-name";
import { cartQuote, lastCheckoutDetails, orderTotals, shippingRule } from "@/modules/store/orders";
import { ADDRESS_LIMIT, listAddresses } from "@/modules/store/account-addresses";
import { checkoutPrefill } from "@/modules/store/checkout-prefill";
import { paymentsEnabled } from "@/modules/payments/checkout";
import { installmentSettings } from "@/modules/payments/installment-settings";
import { installmentOptions } from "@/modules/payments/installment-plan";
import { InstallmentPicker, InstallmentProvider } from "@/components/checkout-installments";
import { OrderSummary, CheckoutSummaryToggle } from "@/components/order-summary";
import { cartOrderable } from "@/components/cart-orderable";
import { CheckoutSteps } from "@/components/checkout-steps";
import { CheckoutForm } from "@/components/checkout-form";
import { CheckoutErrorAlert, cartLineNames, checkoutAlertClass, type CheckoutError } from "@/components/checkout-error-alert";
import { CartFreshness } from "@/components/navigation/cart-badge";
import { TrackBeginCheckout } from "@/components/privacy/track-commerce";
import { cartAnalyticsItems } from "@/modules/analytics/cart-items.server";
import { money } from "@/modules/store/catalog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CheckoutInvoiceFields } from "@/components/checkout-address-fields";
import { CheckoutDeliveryFields } from "@/components/checkout-delivery-fields";
import { checkoutCheckbox, checkoutLabel, checkoutTextarea } from "@/components/checkout-field-classes";
import { catalogPath } from "@/modules/seo/paths";

const errors:Record<string,string>={supplier:"Tedarikçi fiyat ve stok bilgisi şu anda doğrulanamadı. Biraz sonra yeniden dene.",stock:"Ürün fiyatı veya stok durumu uygun değil. Sepetini kontrol edip güncelle.",price:"Fiyatlar, servis indirimi veya sipariş veri kaynağı değişti. Güncel toplamı kontrol ederek siparişini tekrar onayla.",validation:"İletişim, teslimat ve fatura bilgilerini tamamla; sözleşmeleri onayla.",session:"Sepet oturumu sona erdi.",payment:"Online ödeme şu anda kapalı. Lütfen daha sonra tekrar dene."};

const label=checkoutLabel, textarea=checkoutTextarea;

export const metadata: Metadata = { robots: privatePageRobots };
export default async function Checkout({searchParams}:{searchParams:Promise<SearchParams>}) {
  const [account,owner,params]=await Promise.all([currentAccount(),currentCartOwner(),searchParams.then(normalizeSearchParams)]);
  // An account's next checkout starts from its default saved addresses (#950) and its latest order's address and invoice (#881); guests start empty.
  const [items,shipping,installments,last,addresses]=await Promise.all([cartFor(owner),shippingRule(),installmentSettings(),owner?.kind==="account" ? lastCheckoutDetails(owner.id) : null,
    owner?.kind==="account" ? listAddresses(owner.id) : []]);
  // The saved addresses (#999) are listed once; the defaults are read from that list.
  const defaults={delivery:addresses.find(a=>a.default_delivery) ?? null,invoice:addresses.find(a=>a.default_invoice) ?? null};
  const prefill=checkoutPrefill(account,defaults,last);
  const discount=account?.approved && account.role==="service" ? account.discount_percent : 0;
  const totals=orderTotals(items,discount,shipping);
  // Payment options (#886): only the single payment when installments are off or the basket is below the minimum.
  // The provider is always rendered so a refresh that changes the options keeps the form (and its error) mounted.
  const options=installmentOptions(installments,totals.total,totals.subtotal);
  const analytics=await cartAnalyticsItems(items,discount);
  const enabled=paymentsEnabled();
  // Error alerts name the lines as the cart and the order do (#952).
  const lineNames:Record<string,string>=Object.fromEntries(items.map(p=>[p.id,shownProductName(p)]));
  // Only ids of this cart's lines are named, by the cart's own names; the parameter's text is never shown (#788).
  const pageError:CheckoutError|null=params.error ? {code:params.error,names:cartLineNames((params.urun??"").split(","),lineNames),field:params.alan} : null;
  const valid=enabled && items.length>0 && cartOrderable(items);
  return <div className="bg-[#f8f9f9] text-foreground"><CartFreshness count={items.reduce((n,p)=>n+p.quantity,0)}/><section className="mx-auto min-h-[550px] w-full max-w-[1350px] px-[15px] pb-12 max-[760px]:px-3">
    <div className="flex items-center justify-between gap-6 py-9 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5 max-[760px]:py-7"><h1 className="m-0 text-[28px] leading-9 font-semibold tracking-[-0.7px]">Siparişi tamamla</h1>
      <CheckoutSteps/></div>
    {/* With the form on the page, it shows the error itself and replaces it with the next attempt's (one alert, not two). */}
    {pageError && !items.length && <CheckoutErrorAlert error={pageError} errors={errors}/>}
    {!enabled && !params.error && items.length>0 && <Alert className={checkoutAlertClass}>{errors.payment}</Alert>}
    {items.length ? <InstallmentProvider options={options}><div className="grid grid-cols-[minmax(0,1.76fr)_minmax(320px,1fr)] items-start gap-4 max-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] max-[760px]:grid-cols-1">{valid && <TrackBeginCheckout items={analytics.map(line=>line.item)}/>}<CheckoutSummaryToggle items={items} discount={discount} shipping={shipping}/>
      <Card className="gap-0 rounded-[10px] p-5 ring-0 border border-border max-[760px]:px-4"><h2 className="mb-2 text-xl leading-7 font-semibold tracking-[-0.5px]">Müşteri ve teslimat bilgileri</h2><p className="mb-7 text-sm text-muted-foreground">{discount ? `${account!.name} · %${discount} servis indirimi uygulanıyor.` : account ? `${account.name} hesabıyla sipariş veriyorsun.` : "Üye olmadan sipariş verebilirsin."}</p>
      <CheckoutForm analyticsItems={analytics.map(line=>line.item)} disabled={!valid} total={money(totals.total)} errors={errors} lineNames={lineNames} initialError={pageError}><input type="hidden" name="requestKey" value={randomUUID()}/><input type="hidden" name="quote" value={cartQuote(items,discount,shipping,installments)}/>
        <CheckoutDeliveryFields prefill={prefill} email={account?.email} addresses={addresses} canSave={owner?.kind==="account" && addresses.length<ADDRESS_LIMIT} manage={account?.approved===true}/>
        <Field className="gap-1.5"><FieldLabel htmlFor="checkout-note" className={label}>Sipariş notu</FieldLabel><Textarea id="checkout-note" className={cn(textarea,"min-h-20")} name="note" maxLength={1000} rows={2}/></Field>
        <CheckoutInvoiceFields initial={prefill.invoice} addresses={addresses} selectedId={prefill.invoiceAddressId}/>
        {options.length>1 && <InstallmentPicker/>}
        <Field orientation="horizontal" className="items-start gap-2.5"><Checkbox id="checkout-consent" name="consent" required className={checkoutCheckbox}/><FieldLabel htmlFor="checkout-consent" className="block text-sm leading-[22px] font-normal"><Link href="/on-bilgilendirme-formu" target="_blank" className="hover:text-primary hover:underline">Ön bilgilendirme formunu</Link> ve <Link href="/mesafeli-satis-sozlesmesi" target="_blank" className="hover:text-primary hover:underline">mesafeli satış sözleşmesini</Link> okudum, onaylıyorum. Ödemenin TAMI güvenli ödeme sayfasında alınacağını; tedarikçi stoku teyit edilemezse siparişin iptal edilip ödemenin iade edileceğini biliyorum.</FieldLabel></Field>
      </CheckoutForm><p className="mt-[18px] mb-6 flex flex-wrap items-center gap-1.5 text-xs leading-[18px] text-muted-foreground"><LockKeyhole className="size-[15px]" aria-hidden/>Bilgilerin yalnız sipariş işlemleri için kullanılır. <Link href="/gizlilik-politikasi" className="text-[#0065a5] hover:underline">Gizlilik politikası</Link></p><Link href="/sepet" className="inline-flex min-h-11 items-center hover:text-primary">← Sepete dön</Link></Card><OrderSummary items={items} discount={discount} shipping={shipping} checkout/></div></InstallmentProvider>
    : <Empty className="gap-6 rounded-none border-0 px-4 py-16"><h2 className="m-0 text-2xl leading-[34px] font-semibold">Sepetin henüz boş.</h2><Button nativeButton={false} className="h-auto min-h-12 gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5 font-semibold hover:bg-brand-strong" render={<Link href={catalogPath}/>}>Alışverişe başla</Button></Empty>}
  </section></div>;
}
