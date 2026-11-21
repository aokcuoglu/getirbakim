-- Partner webhooks (#1002): an outbox of events for a partner's own system. A change to a partner order that the partner
-- can see (its status, shipment, cancellation or cancel request; the columns toPartnerOrderDto reads that change after
-- the order is placed) adds one 'partner.order.updated' row, and a decision on a partner return request (approved or
-- rejected) one 'partner.return.updated' row, each in the same transaction, by the triggers below. Delivery
-- (src/modules/partner/webhooks.ts) claims pending rows with a lease and POSTs the order or the return request as it is
-- at send time, signed per partner (PARTNER_WEBHOOKS_JSON). 'skipped' = the partner has no endpoint (or the order or
-- request is gone); 'dead' = undelivered after 72 hours (an admin may requeue it: pending again, same id). Delivered,
-- skipped and dead rows are deleted 90 days after their last change by the 5-minute sweep.
-- Applied last in scripts/setup.ts: it reads commerce_orders, partner_return_requests and accounts.
--
-- Locks: the first deploy that creates the table takes, for that run only, SHARE ROW EXCLUSIVE on commerce_orders,
-- partner_return_requests and accounts (the foreign keys) and on commerce_orders again for the order trigger. The first
-- run that adds the return trigger takes SHARE ROW EXCLUSIVE on partner_return_requests once. Later runs take no table
-- lock: the indexes and the triggers are created only when missing. A changed function body needs only its
-- CREATE OR REPLACE FUNCTION; a changed trigger definition (columns, WHEN) needs a DROP TRIGGER in the same change.
CREATE TABLE IF NOT EXISTS partner_webhook_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 partner_code text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('partner.order.updated','partner.return.updated')),
 order_id uuid NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
 return_request_id uuid REFERENCES partner_return_requests(id) ON DELETE CASCADE,
 -- The order's store status when the event was written, for the admin list; the body carries the state at send time.
 order_status text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','skipped','dead')),
 attempts integer NOT NULL DEFAULT 0,
 claimed_at timestamptz,
 delivered_at timestamptz,
 last_http_status integer,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 -- An admin's requeue of a dead row (/yonetim/partnerler); the 72-hour give-up and the 90-day retention count from it.
 requeued_at timestamptz,
 requeued_by uuid REFERENCES accounts(id)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_webhook_events'::regclass AND c.relname='partner_webhook_events_pending_idx') THEN
  CREATE INDEX partner_webhook_events_pending_idx ON partner_webhook_events(created_at) WHERE status='pending';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_webhook_events'::regclass AND c.relname='partner_webhook_events_order_idx') THEN
  CREATE INDEX partner_webhook_events_order_idx ON partner_webhook_events(order_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='partner_webhook_events'::regclass AND c.relname='partner_webhook_events_partner_idx') THEN
  CREATE INDEX partner_webhook_events_partner_idx ON partner_webhook_events(partner_code,created_at DESC);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION partner_webhook_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO partner_webhook_events(partner_code,event_type,order_id,order_status) VALUES(NEW.owner_id,'partner.order.updated',NEW.id,NEW.status);
 RETURN NULL;
END $$;
-- Partner orders only, and only when a partner-visible column changed: an invoice mark, a payment note or an update
-- that writes the same values adds nothing.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='commerce_orders'::regclass AND tgname='partner_webhook_order_event') THEN
  CREATE TRIGGER partner_webhook_order_event AFTER UPDATE ON commerce_orders FOR EACH ROW
   WHEN (NEW.owner_kind='partner' AND (OLD.status,OLD.carrier,OLD.carrier_name,OLD.tracking_no,OLD.tracking_url,OLD.shipped_at,
     OLD.delivered_at,OLD.cancelled_by,OLD.cancelled_at,OLD.cancel_requested_at,OLD.cancel_request_rejected_at)
    IS DISTINCT FROM (NEW.status,NEW.carrier,NEW.carrier_name,NEW.tracking_no,NEW.tracking_url,NEW.shipped_at,
     NEW.delivered_at,NEW.cancelled_by,NEW.cancelled_at,NEW.cancel_requested_at,NEW.cancel_request_rejected_at))
   EXECUTE FUNCTION partner_webhook_order_event();
 END IF;
END $$;

CREATE OR REPLACE FUNCTION partner_webhook_return_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO partner_webhook_events(partner_code,event_type,order_id,return_request_id,order_status)
  SELECT NEW.partner_code,'partner.return.updated',NEW.order_id,NEW.id,o.status FROM commerce_orders o WHERE o.id=NEW.order_id;
 RETURN NULL;
END $$;
-- Only a decision (requested → approved or rejected) adds an event: the partner's own POST answer carries the new request.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='partner_return_requests'::regclass AND tgname='partner_webhook_return_event') THEN
  CREATE TRIGGER partner_webhook_return_event AFTER UPDATE ON partner_return_requests FOR EACH ROW
   WHEN (OLD.status IS DISTINCT FROM NEW.status)
   EXECUTE FUNCTION partner_webhook_return_event();
 END IF;
END $$;
