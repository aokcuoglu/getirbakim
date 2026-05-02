-- Add new request statuses: quoted, closed
-- Replace the old check constraint to include the new statuses
ALTER TABLE product_requests DROP CONSTRAINT IF EXISTS product_requests_status_check;
ALTER TABLE product_requests ADD CONSTRAINT product_requests_status_check
  CHECK (status IN ('pending', 'contacted', 'quoted', 'closed', 'cancelled'));