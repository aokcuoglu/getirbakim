import type { AccountAddress } from "./account-addresses";
import type { CheckoutDetails } from "./orders";
import type { InvoiceType } from "./tr-address";

type Address = { province: string | null; district: string | null; addressLine: string | null; postalCode: string | null };
export type CheckoutPrefill = {
  name: string | undefined; phone: string | undefined; delivery: Address | null;
  /** The saved addresses the form starts from (#999); the invoice id only when it is another row than the delivery one. */
  deliveryAddressId: string | null; invoiceAddressId: string | null;
  invoice: { invoiceType: InvoiceType | null; company: string | null; taxNo: string | null; taxOffice: string | null; address: Address | null } | null;
};

const saved = (address: AccountAddress): Address =>
  ({ province: address.province, district: address.district, addressLine: address.address_line, postalCode: address.postal_code });

/**
 * Where an account's checkout form starts (#950). The default delivery address fills the recipient's name, phone and the
 * delivery address; without one the account name and the latest order's phone and address do (#881). The invoice goes
 * to a default invoice address that is another row, to the delivery address when the same row is both defaults, and
 * otherwise to the latest order's invoice address. The invoice type, title, tax id and tax office always come from the
 * latest order. Guests (no account) start empty.
 */
export function checkoutPrefill(account: { name: string } | null, defaults: { delivery: AccountAddress | null; invoice: AccountAddress | null } | null,
  last: CheckoutDetails | null): CheckoutPrefill {
  const delivery = defaults?.delivery ?? null, invoice = defaults?.invoice ?? null;
  const lastDelivery: Address | null = last && { province: last.delivery_province, district: last.delivery_district, addressLine: last.delivery_address_line, postalCode: last.delivery_postal_code };
  const lastInvoice: Address = { province: last?.invoice_province ?? null, district: last?.invoice_district ?? null, addressLine: last?.invoice_address_line ?? null, postalCode: last?.invoice_postal_code ?? null };
  const invoiceAddress = invoice ? (invoice.id === delivery?.id ? null : saved(invoice)) : lastInvoice;
  const identity = { invoiceType: last?.invoice_type ?? null, company: last?.invoice_company ?? null, taxNo: last?.invoice_tax_no ?? null, taxOffice: last?.invoice_tax_office ?? null };
  return {
    name: delivery?.recipient_name ?? account?.name,
    phone: delivery?.phone ?? last?.phone ?? undefined,
    delivery: delivery ? saved(delivery) : lastDelivery,
    deliveryAddressId: delivery?.id ?? null,
    invoiceAddressId: invoice && invoice.id !== delivery?.id ? invoice.id : null,
    invoice: last || invoiceAddress?.province ? { ...identity, address: invoiceAddress } : null,
  };
}
