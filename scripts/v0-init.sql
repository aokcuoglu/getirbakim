-- v0 schema tables that are not managed by Prisma
-- Created by external data pipelines
-- This script ensures they exist on fresh DBs

-- 1. product_sources
CREATE TABLE IF NOT EXISTS v0.product_sources (
    id BIGINT NOT NULL,
    v0_product_id BIGINT NOT NULL,
    source_type TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    dnmk_products_id BIGINT,
    bsbg_products_id BIGINT,
    ptdrk_products_id INTEGER,
    product_mapping_id INTEGER,
    source_sku TEXT,
    source_brand TEXT,
    source_name TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. product_public_part_links
CREATE TABLE IF NOT EXISTS v0.product_public_part_links (
    id BIGINT NOT NULL,
    v0_product_id BIGINT NOT NULL,
    part_id BIGINT NOT NULL,
    product_mapping_id INTEGER,
    status TEXT NOT NULL DEFAULT 'CANDIDATE',
    match_reason TEXT NOT NULL,
    confidence NUMERIC NOT NULL,
    evidence_json JSONB,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by TEXT,
    review_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. product_code_signals
CREATE TABLE IF NOT EXISTS v0.product_code_signals (
    id BIGINT NOT NULL,
    v0_product_id BIGINT NOT NULL,
    product_source_id BIGINT,
    source_type TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    raw_code TEXT NOT NULL,
    normalized_code TEXT NOT NULL,
    code_kind TEXT NOT NULL,
    origin TEXT NOT NULL,
    confidence NUMERIC NOT NULL,
    evidence_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. public_part_code_lookup
CREATE TABLE IF NOT EXISTS v0.public_part_code_lookup (
    id BIGINT NOT NULL,
    code_kind TEXT NOT NULL,
    normalized_code TEXT NOT NULL,
    part_id BIGINT NOT NULL,
    matched_code TEXT NOT NULL,
    match_reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sequences
CREATE SEQUENCE IF NOT EXISTS v0.product_sources_id_seq OWNED BY v0.product_sources.id;
CREATE SEQUENCE IF NOT EXISTS v0.product_public_part_links_id_seq OWNED BY v0.product_public_part_links.id;
CREATE SEQUENCE IF NOT EXISTS v0.product_code_signals_id_seq OWNED BY v0.product_code_signals.id;
CREATE SEQUENCE IF NOT EXISTS v0.public_part_code_lookup_id_seq OWNED BY v0.public_part_code_lookup.id;

-- Set defaults (only if not already set)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'v0' AND table_name = 'product_sources' AND column_name = 'id'
        AND column_default IS NULL
    ) THEN
        ALTER TABLE v0.product_sources ALTER COLUMN id SET DEFAULT nextval('v0.product_sources_id_seq');
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'v0' AND table_name = 'product_public_part_links' AND column_name = 'id'
        AND column_default IS NULL
    ) THEN
        ALTER TABLE v0.product_public_part_links ALTER COLUMN id SET DEFAULT nextval('v0.product_public_part_links_id_seq');
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'v0' AND table_name = 'product_code_signals' AND column_name = 'id'
        AND column_default IS NULL
    ) THEN
        ALTER TABLE v0.product_code_signals ALTER COLUMN id SET DEFAULT nextval('v0.product_code_signals_id_seq');
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'v0' AND table_name = 'public_part_code_lookup' AND column_name = 'id'
        AND column_default IS NULL
    ) THEN
        ALTER TABLE v0.public_part_code_lookup ALTER COLUMN id SET DEFAULT nextval('v0.public_part_code_lookup_id_seq');
    END IF;
END $$;

-- Primary keys
ALTER TABLE v0.product_sources ADD PRIMARY KEY IF NOT EXISTS (id);
ALTER TABLE v0.product_public_part_links ADD PRIMARY KEY IF NOT EXISTS (id);
ALTER TABLE v0.product_code_signals ADD PRIMARY KEY IF NOT EXISTS (id);
ALTER TABLE v0.public_part_code_lookup ADD PRIMARY KEY IF NOT EXISTS (id);

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS product_sources_source_type_source_record_id_key
    ON v0.product_sources (source_type, source_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_public_part_links_v0_product_id_part_id_key
    ON v0.product_public_part_links (v0_product_id, part_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_code_signals_v0_product_id_source_type_source_recor_key
    ON v0.product_code_signals (v0_product_id, source_type, source_record_id, normalized_code, origin);

CREATE UNIQUE INDEX IF NOT EXISTS public_part_code_lookup_code_kind_normalized_code_part_id_m_key
    ON v0.public_part_code_lookup (code_kind, normalized_code, part_id, match_reason, matched_code);

-- Other indexes
CREATE INDEX IF NOT EXISTS idx_product_sources_v0_product ON v0.product_sources (v0_product_id);
CREATE INDEX IF NOT EXISTS idx_product_sources_dnmk ON v0.product_sources (dnmk_products_id);
CREATE INDEX IF NOT EXISTS idx_product_sources_bsbg ON v0.product_sources (bsbg_products_id);
CREATE INDEX IF NOT EXISTS idx_product_sources_ptdrk ON v0.product_sources (ptdrk_products_id);
CREATE INDEX IF NOT EXISTS idx_product_sources_mapping ON v0.product_sources (product_mapping_id);

CREATE INDEX IF NOT EXISTS idx_product_public_part_links_product_status ON v0.product_public_part_links (v0_product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_public_part_links_status ON v0.product_public_part_links (status);
CREATE INDEX IF NOT EXISTS idx_product_public_part_links_part ON v0.product_public_part_links (part_id);

CREATE INDEX IF NOT EXISTS idx_product_code_signals_v0_product ON v0.product_code_signals (v0_product_id);
CREATE INDEX IF NOT EXISTS idx_product_code_signals_kind_code ON v0.product_code_signals (code_kind, normalized_code);
CREATE INDEX IF NOT EXISTS idx_product_code_signals_normalized ON v0.product_code_signals (normalized_code);

CREATE INDEX IF NOT EXISTS idx_public_part_code_lookup_kind_code ON v0.public_part_code_lookup (code_kind, normalized_code);
CREATE INDEX IF NOT EXISTS idx_public_part_code_lookup_part ON v0.public_part_code_lookup (part_id);

-- Foreign keys (IF NOT EXISTS equivalent via dynamic SQL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_sources_v0_product_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'products') THEN
        ALTER TABLE v0.product_sources ADD CONSTRAINT product_sources_v0_product_id_fkey
            FOREIGN KEY (v0_product_id) REFERENCES v0.products(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_sources_dnmk_products_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'dnmk_products') THEN
        ALTER TABLE v0.product_sources ADD CONSTRAINT product_sources_dnmk_products_id_fkey
            FOREIGN KEY (dnmk_products_id) REFERENCES v0.dnmk_products(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_sources_bsbg_products_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'bsbg_products') THEN
        ALTER TABLE v0.product_sources ADD CONSTRAINT product_sources_bsbg_products_id_fkey
            FOREIGN KEY (bsbg_products_id) REFERENCES v0.bsbg_products(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_sources_ptdrk_products_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'ptdrk_products') THEN
        ALTER TABLE v0.product_sources ADD CONSTRAINT product_sources_ptdrk_products_id_fkey
            FOREIGN KEY (ptdrk_products_id) REFERENCES v0.ptdrk_products(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_sources_product_mapping_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'product_mapping') THEN
        ALTER TABLE v0.product_sources ADD CONSTRAINT product_sources_product_mapping_id_fkey
            FOREIGN KEY (product_mapping_id) REFERENCES v0.product_mapping(id) ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_public_part_links_v0_product_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'products') THEN
        ALTER TABLE v0.product_public_part_links ADD CONSTRAINT product_public_part_links_v0_product_id_fkey
            FOREIGN KEY (v0_product_id) REFERENCES v0.products(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_public_part_links_part_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parts') THEN
        ALTER TABLE v0.product_public_part_links ADD CONSTRAINT product_public_part_links_part_id_fkey
            FOREIGN KEY (part_id) REFERENCES public.parts(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_public_part_links_product_mapping_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'product_mapping') THEN
        ALTER TABLE v0.product_public_part_links ADD CONSTRAINT product_public_part_links_product_mapping_id_fkey
            FOREIGN KEY (product_mapping_id) REFERENCES v0.product_mapping(id) ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_code_signals_v0_product_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'products') THEN
        ALTER TABLE v0.product_code_signals ADD CONSTRAINT product_code_signals_v0_product_id_fkey
            FOREIGN KEY (v0_product_id) REFERENCES v0.products(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'product_code_signals_product_source_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'v0' AND table_name = 'product_sources') THEN
        ALTER TABLE v0.product_code_signals ADD CONSTRAINT product_code_signals_product_source_id_fkey
            FOREIGN KEY (product_source_id) REFERENCES v0.product_sources(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'v0' AND constraint_name = 'public_part_code_lookup_part_id_fkey'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parts') THEN
        ALTER TABLE v0.public_part_code_lookup ADD CONSTRAINT public_part_code_lookup_part_id_fkey
            FOREIGN KEY (part_id) REFERENCES public.parts(id) ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;
