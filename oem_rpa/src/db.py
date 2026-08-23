"""PostgreSQL okuma/isaretleme katmani."""

import psycopg2
import psycopg2.extras


def _connect(db_cfg: dict):
    return psycopg2.connect(
        host=db_cfg["host"],
        port=db_cfg.get("port", 5432),
        dbname=db_cfg["dbname"],
        user=db_cfg["user"],
        password=db_cfg["password"],
    )


def mark_attempts(db_cfg: dict, entries: list) -> None:
    """Sorgulanan urunleri catalog.rpa_lookup_log'a isaretler (bos sonuc dahil).

    entries: [(product_id, status, oem_count), ...]  status: FOUND|EMPTY|ERROR
    Ayni urun tekrar sorgulanirsa attempts artar, status/oem_count guncellenir.
    """
    if not entries:
        return
    rows = [(int(pid), str(status), int(oem_count), 1)
            for pid, status, oem_count in entries]
    conn = _connect(db_cfg)
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO catalog.rpa_lookup_log
                    (product_id, status, oem_count, attempts)
                VALUES %s
                ON CONFLICT (product_id) DO UPDATE SET
                    status    = EXCLUDED.status,
                    oem_count = EXCLUDED.oem_count,
                    attempts  = catalog.rpa_lookup_log.attempts + 1,
                    updated_at = now()
                """,
                rows,
                template="(%s,%s,%s,%s)",
            )
        conn.commit()
    finally:
        conn.close()


def fetch_products(db_cfg: dict) -> list:
    """config['database'] ile baglanir, select_query'yi calistirir.

    Donen her satir dict: en az {product_id, brand, part_no}.
    product_id ZORUNLU: kuyruk product_id'siz satiri atlar (ayni part_no
    farkli markalarda tekrar edebildigi icin).
    """
    conn = _connect(db_cfg)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(db_cfg["select_query"])
            rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    # Zorunlu alan kontrolu
    for r in rows:
        for k in ("product_id", "brand", "part_no"):
            if k not in r:
                raise ValueError(
                    f"select_query '{k}' alanini dondurmeli. Donen: {list(r.keys())}"
                )
    return rows
