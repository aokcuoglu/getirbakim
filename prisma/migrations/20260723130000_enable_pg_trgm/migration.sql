-- Enable trigram similarity for manual product matching (similarity() 0..1 score).
-- Prisma does not manage extensions by default, so no schema/drift impact.
-- Queries are brand-scoped (small sets) → no trigram index needed for now.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
