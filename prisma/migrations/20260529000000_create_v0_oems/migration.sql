-- Create v0.oems table for ParcaTedarik-to-part OEM/EAN matching bridge.

CREATE TABLE v0.oems (
    id SERIAL NOT NULL,
    ptprd_id INTEGER NOT NULL,
    part_id BIGINT NOT NULL,
    code TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT oems_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX oems_ptprd_id_part_id_key ON v0.oems (ptprd_id, part_id);

CREATE INDEX idx_oems_ptprd_id ON v0.oems (ptprd_id);
CREATE INDEX idx_oems_part_id ON v0.oems (part_id);

ALTER TABLE v0.oems ADD CONSTRAINT oems_ptprd_id_fkey
    FOREIGN KEY (ptprd_id) REFERENCES v0.ptprd(id) ON DELETE CASCADE;
