CREATE TABLE "catalog"."partner_order_events" (
  "id" UUID NOT NULL,
  "partner_id" TEXT NOT NULL,
  "order_id" UUID NOT NULL,
  "order_version" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "contract_version" TEXT NOT NULL,
  "raw_body" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" TEXT,
  "delivered_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "last_http_status" INTEGER,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_order_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_partner_order_events_version" CHECK ("order_version" > 0),
  CONSTRAINT "ck_partner_order_events_attempts" CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "uq_partner_order_events_version" ON "catalog"."partner_order_events"("order_id", "order_version", "event_type");
CREATE INDEX "partner_order_events_partner_id_created_at_idx" ON "catalog"."partner_order_events"("partner_id", "created_at");
CREATE INDEX "partner_order_events_next_attempt_at_idx" ON "catalog"."partner_order_events"("next_attempt_at");
CREATE INDEX "partner_order_events_due_idx" ON "catalog"."partner_order_events"("next_attempt_at")
  WHERE "delivered_at" IS NULL AND "dead_lettered_at" IS NULL;

ALTER TABLE "catalog"."partner_order_events" ADD CONSTRAINT "partner_order_events_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "catalog"."partner_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
