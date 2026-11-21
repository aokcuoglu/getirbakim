import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { decodeOfferId } from "./dto";
import { lockPartnerOrders } from "./limits";
import { notFound, uuidPattern } from "./orders";
import { fingerprintOrderRequest, PartnerOrderError } from "./quotes";
import { toPartnerReturnDto, type PartnerReturnLineRow, type PartnerReturnRow, type ReturnRequest } from "./return-dto";

/**
 * Partner return requests (#1007, docs/partner-order-contract.md): the partner asks to return lines of a shipped or
 * delivered order; operations approve or reject the request in /yonetim/siparisler. Only an approval writes
 * commerce_returns (the store's accepted returns). A pending request holds its quantity, so per order line accepted
 * returns + pending requests never exceed the ordered quantity; a rejection releases it. Returns do not change the
 * partner's open-order limit or invoicing: a credit note settles an accepted return outside this system.
 */
type Connection = Pick<PoolClient, "query">;

const requestColumns = "id::text,order_id::text,request_key::text,status,note,requested_at,decided_at";

/** The requests' lines, each with its order line (name, code, binding unit price). */
async function requestLines(ids: string[], connection: Connection) {
  const { rows } = await connection.query<PartnerReturnLineRow & { request_id: string }>(
    `SELECT l.request_id::text,l.product_id::text,l.quantity,l.reason,i.code,i.name,i.quantity AS ordered_quantity,i.unit_price_kurus::text,i.pricing_snapshot
     FROM partner_return_request_lines l JOIN commerce_order_items i ON i.order_id=l.order_id AND i.product_id=l.product_id
     WHERE l.request_id=ANY($1::uuid[]) ORDER BY i.code,l.product_id`, [ids]);
  const byRequest = new Map<string, PartnerReturnLineRow[]>();
  for (const row of rows) byRequest.set(row.request_id, [...byRequest.get(row.request_id) ?? [], row]);
  return byRequest;
}

async function toDtos(requests: PartnerReturnRow[], connection: Connection) {
  const lines = await requestLines(requests.map(request => request.id), connection);
  return requests.map(request => toPartnerReturnDto(request, lines.get(request.id) ?? []));
}

/** The request an Idempotency-Key of this partner created, with its body fingerprint. */
async function readByKey(partner: string, key: string, connection: Connection) {
  const request = (await connection.query<PartnerReturnRow & { fingerprint: string }>(
    `SELECT ${requestColumns},fingerprint FROM partner_return_requests WHERE partner_code=$1 AND request_key=$2::uuid`, [partner, key])).rows[0];
  if (!request) return null;
  const [dto] = await toDtos([request], connection);
  return { dto, fingerprint: request.fingerprint };
}

function replay(found: NonNullable<Awaited<ReturnType<typeof readByKey>>>, fingerprint: string) {
  if (found.fingerprint !== fingerprint) throw new PartnerOrderError("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was used for another request.", 409);
  return { return: found.dto, replayed: true };
}

/** Per product of the order: accepted returns (commerce_returns) and quantities held by pending partner requests. */
async function returnedQuantities(orderId: string, connection: Connection, exceptRequest: string | null = null) {
  const accepted = await connection.query<{ product_id: string; quantity: number }>(
    "SELECT product_id::text,sum(quantity)::integer AS quantity FROM commerce_returns WHERE order_id=$1 GROUP BY product_id", [orderId]);
  const pending = await connection.query<{ product_id: string; quantity: number }>(
    `SELECT l.product_id::text,sum(l.quantity)::integer AS quantity FROM partner_return_request_lines l JOIN partner_return_requests r ON r.id=l.request_id
     WHERE l.order_id=$1 AND r.status='requested' AND r.id IS DISTINCT FROM $2::uuid GROUP BY l.product_id`, [orderId, exceptRequest]);
  return {
    accepted: new Map(accepted.rows.map(row => [row.product_id, row.quantity])),
    pending: new Map(pending.rows.map(row => [row.product_id, row.quantity])),
  };
}

/**
 * Records a return request. Checked in this order: idempotent replay, then under the partner's order lock: replay
 * again, the order (this partner's, shipped or delivered), the lines (on the order), the quantities (accepted +
 * pending + requested ≤ ordered), and the insert. The partner's order intake switch (#1009) does not apply.
 */
export async function requestPartnerReturn(partner: string, orderId: string, idempotencyKey: string, request: ReturnRequest) {
  const fingerprint = fingerprintOrderRequest({ orderId: orderId.toLowerCase(), ...request });
  const previous = await readByKey(partner, idempotencyKey, db);
  if (previous) return replay(previous, fingerprint);
  if (!uuidPattern.test(orderId)) throw notFound();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // One request at a time per partner: the Idempotency-Key check sees every earlier request.
    await lockPartnerOrders(client, partner);
    const existing = await readByKey(partner, idempotencyKey, client);
    if (existing) { await client.query("COMMIT"); return replay(existing, fingerprint); }
    // Same row lock as the admin steps, so a return request and an order step never interleave.
    const order = (await client.query<{ status: string }>(
      "SELECT status FROM commerce_orders WHERE id=$1 AND owner_kind='partner' AND owner_id=$2 FOR UPDATE", [orderId, partner])).rows[0];
    if (!order) throw notFound();
    if (order.status !== "shipped" && order.status !== "delivered") {
      throw new PartnerOrderError("ORDER_NOT_SHIPPED", "Only shipped or delivered orders can be returned; cancel the order instead.", 409,
        { status: order.status === "cancelled" ? "CANCELLED" : order.status === "confirmed" ? "CONFIRMED" : "REQUESTED" });
    }
    // The order lines, locked like recordOrderReturn locks one: two returns of the same line wait for each other.
    const items = new Map((await client.query<{ product_id: string; quantity: number }>(
      "SELECT product_id::text,quantity FROM commerce_order_items WHERE order_id=$1 ORDER BY product_id FOR UPDATE", [orderId])).rows
      .map(row => [row.product_id, row.quantity]));
    const lines = request.lines.map(line => ({ ...line, productId: decodeOfferId(line.selectedOfferId) }));
    const unknown = lines.filter(line => !line.productId || !items.has(line.productId));
    if (unknown.length) {
      throw new PartnerOrderError("RETURN_LINE_UNKNOWN", "These offers are not lines of the order.", 409, { selectedOfferIds: unknown.map(line => line.selectedOfferId) });
    }
    // Summed in their own statements, after the locks: a snapshot taken before waiting would miss a return committed meanwhile.
    const { accepted, pending } = await returnedQuantities(orderId, client);
    const counted = lines.map(line => {
      const productId = line.productId as string;
      return { line, productId, orderedQuantity: items.get(productId) ?? 0, returnedQuantity: accepted.get(productId) ?? 0, pendingQuantity: pending.get(productId) ?? 0 };
    });
    const exceeded = counted.filter(item => item.returnedQuantity + item.pendingQuantity + item.line.quantity > item.orderedQuantity);
    if (exceeded.length) {
      throw new PartnerOrderError("RETURN_QUANTITY_EXCEEDED", "The return would exceed the ordered quantity.", 409, {
        lines: exceeded.map(item => ({ selectedOfferId: item.line.selectedOfferId, orderedQuantity: item.orderedQuantity,
          returnedQuantity: item.returnedQuantity, pendingQuantity: item.pendingQuantity, requestedQuantity: item.line.quantity })),
      });
    }
    const created = (await client.query<{ id: string }>(
      "INSERT INTO partner_return_requests(order_id,partner_code,request_key,fingerprint,note) VALUES($1,$2,$3,$4,$5) RETURNING id::text",
      [orderId, partner, idempotencyKey, fingerprint, request.note])).rows[0];
    for (const { line, productId } of counted) {
      await client.query("INSERT INTO partner_return_request_lines(request_id,order_id,product_id,quantity,reason) VALUES($1,$2,$3,$4,$5)",
        [created.id, orderId, productId, line.quantity, line.reason]);
    }
    const saved = await readByKey(partner, idempotencyKey, client);
    if (!saved) throw new Error(`Partner return request ${created.id} is missing in its own transaction`);
    await client.query("COMMIT");
    return { return: saved.dto, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The partner's return requests on one of its orders, oldest first; another partner's (or a store) order is not found. */
export async function listPartnerReturns(partner: string, orderId: string) {
  if (!uuidPattern.test(orderId)) throw notFound();
  const order = await db.query("SELECT 1 FROM commerce_orders WHERE id=$1 AND owner_kind='partner' AND owner_id=$2", [orderId, partner]);
  if (!order.rowCount) throw notFound();
  const { rows } = await db.query<PartnerReturnRow>(
    `SELECT ${requestColumns} FROM partner_return_requests WHERE order_id=$1 AND partner_code=$2 ORDER BY requested_at,id`, [orderId, partner]);
  return toDtos(rows, db);
}

/**
 * Operations' answer to a pending partner return request (callers check the admin session). `approve` writes one
 * commerce_returns row per line (the partner's note, who approved it, the request it came from); `reject` releases the
 * quantity. False when the request is missing or already decided, or (approve) an accepted return no longer leaves room.
 */
export async function decidePartnerReturnRequest(requestId: string, decision: "approve" | "reject", adminId: string | null) {
  const orderId = (await db.query<{ order_id: string }>("SELECT order_id::text FROM partner_return_requests WHERE id=$1", [requestId])).rows[0]?.order_id;
  if (!orderId) return false;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Order, request, then its lines: the same order as a partner's new request takes them.
    await client.query("SELECT 1 FROM commerce_orders WHERE id=$1 FOR UPDATE", [orderId]);
    const request = (await client.query<{ note: string }>(
      "SELECT note FROM partner_return_requests WHERE id=$1 AND status='requested' FOR UPDATE", [requestId])).rows[0];
    if (!request) { await client.query("ROLLBACK"); return false; }
    const lines = (await client.query<{ product_id: string; quantity: number; reason: string; ordered_quantity: number }>(
      `SELECT l.product_id::text,l.quantity,l.reason,i.quantity AS ordered_quantity FROM partner_return_request_lines l
       JOIN commerce_order_items i ON i.order_id=l.order_id AND i.product_id=l.product_id WHERE l.request_id=$1 ORDER BY l.product_id FOR UPDATE OF i`,
    [requestId])).rows;
    if (decision === "approve") {
      const { accepted, pending } = await returnedQuantities(orderId, client, requestId);
      const fits = lines.every(line => (accepted.get(line.product_id) ?? 0) + (pending.get(line.product_id) ?? 0) + line.quantity <= line.ordered_quantity);
      if (!fits) { await client.query("ROLLBACK"); return false; }
      for (const line of lines) {
        await client.query(`INSERT INTO commerce_returns(order_id,product_id,quantity,reason,note,created_by,partner_return_request_id)
          VALUES($1,$2,$3,$4,$5,$6,$7)`, [orderId, line.product_id, line.quantity, line.reason, request.note.slice(0, 500), adminId, requestId]);
      }
    }
    await client.query("UPDATE partner_return_requests SET status=$2,decided_at=now(),decided_by=$3 WHERE id=$1",
      [requestId, decision === "approve" ? "approved" : "rejected", adminId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
