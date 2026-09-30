CREATE TABLE "catalog"."partner_order_actions" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "order_version" INTEGER NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_order_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_order_actions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "catalog"."partner_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_partner_order_actions_version" ON "catalog"."partner_order_actions"("order_id", "order_version");
CREATE INDEX "partner_order_actions_created_at_idx" ON "catalog"."partner_order_actions"("created_at");
