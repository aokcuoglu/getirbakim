import { Badge } from "@/components/ui/badge";
import type { CommerceOrder } from "@/modules/store/orders";
import { invoiceTypes } from "@/modules/store/tr-address";

type DeliveryOrder = Pick<CommerceOrder, "address" | "delivery_province" | "delivery_district" | "delivery_address_line" | "delivery_postal_code"
  | "invoice_type" | "invoice_company" | "invoice_tax_no" | "invoice_tax_office">;

/**
 * Delivery address and invoice of an order as `<dt>/<dd>` pairs for a surrounding `<dl>` (#881). Orders placed before the
 * structured address show their free-text address; those without invoice details say so.
 */
export function OrderDeliveryDetails({ order }: { order: DeliveryOrder }) {
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
          <span className="tabular-nums">VKN {order.invoice_tax_no} · {order.invoice_tax_office} V.D.</span>
        </>}
      </dd> : <dd className="text-muted-foreground">Kayıtlı değil</dd>}
    </div>
  </>;
}

/** Who and where a shipment goes, read-only, for the shipment dialog. */
export function OrderRecipient({ order }: { order: DeliveryOrder & Pick<CommerceOrder, "customer_name" | "phone"> }) {
  return <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
    <div><dt className="text-muted-foreground">Alıcı</dt><dd>{order.customer_name}</dd></div>
    <div><dt className="text-muted-foreground">Telefon</dt><dd className="tabular-nums">{order.phone}</dd></div>
    <OrderDeliveryDetails order={order}/>
  </dl>;
}
