import { Badge } from "@/components/ui/badge";
import type { CommerceOrder } from "@/modules/store/orders";
import { invoiceAddressText, invoiceTypes } from "@/modules/store/tr-address";

type DeliveryOrder = Pick<CommerceOrder, "address" | "delivery_province" | "delivery_district" | "delivery_address_line" | "delivery_postal_code"
  | "invoice_type" | "invoice_company" | "invoice_tax_no" | "invoice_tax_office"
  | "invoice_province" | "invoice_district" | "invoice_address_line" | "invoice_postal_code">;

/**
 * Delivery address and invoice of an order as `<dt>/<dd>` pairs for a surrounding `<dl>` (#881). Orders placed before the
 * structured address show their free-text address; those without invoice details say so. With invoice details, the
 * invoice address is the separate one (#916) or the delivery address; `showInvoiceAddress={false}` leaves it out where
 * only the shipment matters.
 */
export function OrderDeliveryDetails({ order, showInvoiceAddress = true }: { order: DeliveryOrder; showInvoiceAddress?: boolean }) {
  const invoiceAddress = invoiceAddressText(order);
  return <>
    {order.delivery_province ? <>
      <div><dt className="text-muted-foreground">İl / ilçe</dt><dd>{order.delivery_province} / {order.delivery_district}</dd></div>
      <div><dt className="text-muted-foreground">Posta kodu</dt><dd className={order.delivery_postal_code ? "tabular-nums" : "text-muted-foreground"}>{order.delivery_postal_code ?? "Girilmedi"}</dd></div>
      <div className="sm:col-span-2"><dt className="text-muted-foreground">Açık adres</dt><dd className="whitespace-pre-wrap break-words">{order.delivery_address_line}</dd></div>
    </> : <div className="sm:col-span-2"><dt className="text-muted-foreground">Adres</dt><dd className="whitespace-pre-wrap break-words">{order.address}</dd></div>}
    <div className="sm:col-span-2"><dt className="text-muted-foreground">Fatura</dt>
      {order.invoice_type ? <dd className="flex flex-col items-start gap-1">
        <Badge variant="outline">{invoiceTypes[order.invoice_type]}</Badge>
        {order.invoice_type === "corporate" && <>
          <span className="break-words">{order.invoice_company}</span>
          <span className="tabular-nums">Vergi/TC kimlik no {order.invoice_tax_no} · {order.invoice_tax_office} V.D.</span>
        </>}
      </dd> : <dd className="text-muted-foreground">Kayıtlı değil</dd>}
    </div>
    {showInvoiceAddress && order.invoice_type && <div className="sm:col-span-2"><dt className="text-muted-foreground">Fatura adresi</dt>
      {invoiceAddress ? <dd className="whitespace-pre-wrap break-words">{invoiceAddress}</dd> : <dd className="text-muted-foreground">Teslimat adresiyle aynı</dd>}
    </div>}
  </>;
}

/** Who and where a shipment goes, read-only, for the shipment dialog; the invoice address is not part of it. */
export function OrderRecipient({ order }: { order: DeliveryOrder & Pick<CommerceOrder, "customer_name" | "phone"> }) {
  return <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
    <div><dt className="text-muted-foreground">Alıcı</dt><dd>{order.customer_name}</dd></div>
    <div><dt className="text-muted-foreground">Telefon</dt><dd className="tabular-nums">{order.phone}</dd></div>
    <OrderDeliveryDetails order={order} showInvoiceAddress={false}/>
  </dl>;
}
