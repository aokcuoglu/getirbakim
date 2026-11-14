-- "Gelince haber ver" (#475): a shopper asks to be told once when a product nobody supplies now can be ordered again.
-- No email is sent from here; operations see the requests in /yonetim/stok-bildirimleri and notify by hand.
-- The supplier row and product may disappear (FK SET NULL); supplier, code, brand and name keep the request readable.
CREATE TABLE IF NOT EXISTS restock_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
 supplier_item_id uuid REFERENCES supplier_items(id) ON DELETE SET NULL,
 product_id uuid REFERENCES products(id) ON DELETE SET NULL,
 supplier text NOT NULL, code text NOT NULL, brand text NOT NULL, name text NOT NULL,
 account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
 consent_text text NOT NULL,
 consent_version text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','notified','withdrawn')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 notified_at timestamptz,
 notified_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
 CHECK ((status='notified')=(notified_at IS NOT NULL))
);
-- One open request per address and product code; asking again changes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS restock_requests_open_idx ON restock_requests(email,supplier,code) WHERE status='pending';
CREATE INDEX IF NOT EXISTS restock_requests_status_idx ON restock_requests(status,requested_at DESC);
CREATE TABLE IF NOT EXISTS restock_request_attempts (
 key text PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT now()
);
-- Retention (legal pages, "Stok bildirim talepleri"): a notified request 30 days after the notice, an unanswered
-- one 12 months after it was made, a withdrawn one at once; stale rate-limit windows after a day.
-- Run by the supplier scheduler (scripts/sync-suppliers.ts) next to the supplier history pruning.
CREATE OR REPLACE FUNCTION prune_restock_requests() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE notified integer; pending integer; withdrawn integer; attempts integer;
BEGIN
 DELETE FROM restock_requests WHERE status='notified' AND notified_at<now()-interval '30 days';
 GET DIAGNOSTICS notified = ROW_COUNT;
 DELETE FROM restock_requests WHERE status='pending' AND requested_at<now()-interval '12 months';
 GET DIAGNOSTICS pending = ROW_COUNT;
 DELETE FROM restock_requests WHERE status='withdrawn';
 GET DIAGNOSTICS withdrawn = ROW_COUNT;
 DELETE FROM restock_request_attempts WHERE window_start<now()-interval '1 day';
 GET DIAGNOSTICS attempts = ROW_COUNT;
 RETURN jsonb_build_object('notified',notified,'pending',pending,'withdrawn',withdrawn,'attempts',attempts);
END $$;
