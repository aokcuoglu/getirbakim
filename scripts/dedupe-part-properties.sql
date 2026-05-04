-- Migration: deduplicate part_properties and add unique constraint on (part_id, key)
-- Split into steps to avoid Supabase statement timeout.

-- Step 0: Disable statement timeout for this session
SET statement_timeout = 0;

-- Step 1: Delete duplicate rows, keeping the highest id per (part_id, key)
DELETE FROM part_properties a
USING part_properties b
WHERE a.part_id = b.part_id
  AND LOWER(a.key) = LOWER(b.key)
  AND a.id < b.id;

-- Step 2: Add unique constraint
ALTER TABLE part_properties
  ADD CONSTRAINT part_properties_part_id_key_unique UNIQUE (part_id, key);
