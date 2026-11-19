import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { addressInput, addressKey, type AddressInput } from "./address-schema";

/** Most saved addresses one account keeps (#950). */
export const ADDRESS_LIMIT = 10;

export type AccountAddress = {
  id: string; label: string; recipient_name: string; phone: string; province: string; district: string; address_line: string; postal_code: string | null;
  default_delivery: boolean; default_invoice: boolean;
};
export type AddressKind = "delivery" | "invoice";

const columns = "id,label,recipient_name,phone,province,district,address_line,postal_code,default_delivery,default_invoice";
// Fixed column names by kind, never taken from input.
const flagColumn = { delivery: "default_delivery", invoice: "default_invoice" } as const satisfies Record<AddressKind, string>;

/** The account's saved addresses, the default delivery address first, then oldest first. */
export async function listAddresses(accountId: string) {
  return (await db.query<AccountAddress>(`SELECT ${columns} FROM account_addresses WHERE account_id=$1 ORDER BY default_delivery DESC,created_at,id`, [accountId])).rows;
}

/** One of the account's addresses; null when it does not exist or belongs to another account. */
export async function getAddress(accountId: string, id: string) {
  return (await db.query<AccountAddress>(`SELECT ${columns} FROM account_addresses WHERE account_id=$1 AND id=$2`, [accountId, id])).rows[0] ?? null;
}

/** The default delivery and invoice addresses of the account, in one read; one row may be both. */
export async function defaultAddresses(accountId: string): Promise<{ delivery: AccountAddress | null; invoice: AccountAddress | null }> {
  const { rows } = await db.query<AccountAddress>(`SELECT ${columns} FROM account_addresses WHERE account_id=$1 AND (default_delivery OR default_invoice)`, [accountId]);
  return { delivery: rows.find(row => row.default_delivery) ?? null, invoice: rows.find(row => row.default_invoice) ?? null };
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Serialises the account's address writes: the limit count and the default flags are read after the lock, in a fresh
 * snapshot, so two concurrent saves can neither pass the limit nor both leave a default behind.
 */
async function lockAccount(client: PoolClient, accountId: string) {
  await client.query("SELECT 1 FROM accounts WHERE id=$1 FOR NO KEY UPDATE", [accountId]);
}

/**
 * Clears the requested default flags on the account's other rows, before the row taking them is written, so the
 * partial unique indexes never see two defaults.
 */
async function clearDefaults(client: PoolClient, accountId: string, keepId: string | null, delivery: boolean, invoice: boolean) {
  if (!delivery && !invoice) return;
  await client.query(`UPDATE account_addresses SET default_delivery=default_delivery AND NOT $3,default_invoice=default_invoice AND NOT $4,updated_at=now()
    WHERE account_id=$1 AND id IS DISTINCT FROM $2 AND ((default_delivery AND $3) OR (default_invoice AND $4))`, [accountId, keepId, delivery, invoice]);
}

/** Writes one row, clearing the defaults it takes; the caller holds the account lock. */
async function insertAddress(client: PoolClient, accountId: string, input: AddressInput, delivery: boolean, invoice: boolean) {
  await clearDefaults(client, accountId, null, delivery, invoice);
  const { rows } = await client.query<{ id: string }>(`INSERT INTO account_addresses(account_id,label,recipient_name,phone,province,district,address_line,postal_code,default_delivery,default_invoice)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [accountId, input.label, input.recipientName, input.phone, input.province, input.district, input.addressLine, input.postalCode, delivery, invoice]);
  return rows[0].id;
}

/**
 * Saves a new address; `{ error: "limit" }` when the account already keeps ADDRESS_LIMIT. The account's first address
 * becomes both its default delivery and default invoice address.
 */
export async function createAddress(accountId: string, input: AddressInput): Promise<{ id: string } | { error: "limit" }> {
  return transaction(async client => {
    await lockAccount(client, accountId);
    const count = Number((await client.query<{ count: string }>("SELECT count(*) FROM account_addresses WHERE account_id=$1", [accountId])).rows[0].count);
    if (count >= ADDRESS_LIMIT) return { error: "limit" as const };
    return { id: await insertAddress(client, accountId, input, count === 0 || input.defaultDelivery, count === 0 || input.defaultInvoice) };
  });
}

type CheckoutAddress = { name: string; phone: string; province: string; district: string; addressLine: string; postalCode: string | null; saveAddressLabel: string };

/**
 * Saves the delivery address of a placed order to the account's address book (#999), after the order succeeded. Never
 * throws: a refused or failed save must not affect the order. "skipped" for guests, an invalid candidate or a failure;
 * "duplicate" when the account already has the same province, district and street address; "limit" when the book is full.
 * It takes no default flag, except that the first address becomes both defaults. An empty label becomes "İlçe / İl".
 */
export async function saveCheckoutAddress(owner: { kind: string; id: string }, checkout: CheckoutAddress): Promise<"saved" | "duplicate" | "limit" | "skipped"> {
  try {
    if (owner.kind !== "account") return "skipped";
    const candidate = addressInput.safeParse({ label: checkout.saveAddressLabel || `${checkout.district} / ${checkout.province}`, recipientName: checkout.name, phone: checkout.phone,
      province: checkout.province, district: checkout.district, addressLine: checkout.addressLine, postalCode: checkout.postalCode ?? "" });
    if (!candidate.success) return "skipped";
    return await transaction(async client => {
      // The order is already placed: a stuck account lock must not hold the response; the timeout lands in the catch below.
      await client.query("SET LOCAL lock_timeout = '2s'");
      await lockAccount(client, owner.id);
      const { rows } = await client.query<{ province: string; district: string; address_line: string }>("SELECT province,district,address_line FROM account_addresses WHERE account_id=$1", [owner.id]);
      const key = addressKey(candidate.data);
      if (rows.some(row => addressKey({ province: row.province, district: row.district, addressLine: row.address_line }) === key)) return "duplicate" as const;
      if (rows.length >= ADDRESS_LIMIT) return "limit" as const;
      const first = rows.length === 0;
      await insertAddress(client, owner.id, candidate.data, first, first);
      return "saved" as const;
    });
  } catch (error) {
    console.error("Checkout address could not be saved", error);
    return "skipped";
  }
}

/**
 * Updates one of the account's addresses; false when it is not the account's. A ticked box makes it the default; an
 * unticked one leaves its current flag, so an edit never drops a default (another address takes it over instead).
 */
export async function updateAddress(accountId: string, id: string, input: AddressInput) {
  return transaction(async client => {
    await lockAccount(client, accountId);
    const own = await client.query("SELECT 1 FROM account_addresses WHERE account_id=$1 AND id=$2", [accountId, id]);
    if (!own.rowCount) return false;
    await clearDefaults(client, accountId, id, input.defaultDelivery, input.defaultInvoice);
    await client.query(`UPDATE account_addresses SET label=$3,recipient_name=$4,phone=$5,province=$6,district=$7,address_line=$8,postal_code=$9,
      default_delivery=default_delivery OR $10,default_invoice=default_invoice OR $11,updated_at=now() WHERE account_id=$1 AND id=$2`,
      [accountId, id, input.label, input.recipientName, input.phone, input.province, input.district, input.addressLine, input.postalCode, input.defaultDelivery, input.defaultInvoice]);
    return true;
  });
}

/** Deletes one of the account's addresses; false when it is not the account's. A deleted default is not reassigned. */
export async function deleteAddress(accountId: string, id: string) {
  return ((await db.query("DELETE FROM account_addresses WHERE account_id=$1 AND id=$2", [accountId, id])).rowCount ?? 0) > 0;
}

/** Makes one of the account's addresses its default delivery or invoice address; false when it is not the account's. */
export async function setDefaultAddress(accountId: string, id: string, kind: AddressKind) {
  return transaction(async client => {
    await lockAccount(client, accountId);
    const own = await client.query("SELECT 1 FROM account_addresses WHERE account_id=$1 AND id=$2", [accountId, id]);
    if (!own.rowCount) return false;
    await clearDefaults(client, accountId, id, kind === "delivery", kind === "invoice");
    await client.query(`UPDATE account_addresses SET ${flagColumn[kind]}=true,updated_at=now() WHERE account_id=$1 AND id=$2`, [accountId, id]);
    return true;
  });
}
