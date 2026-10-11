import { request } from "node:https";
import { rootCertificates } from "node:tls";
import { z } from "zod";
import type { Pool } from "pg";
import { applySupplierSnapshot, rejectionReason, type ObservationItem } from "./sync";

// Shared by the scheduler and CLI. Dinamik publishes one stock list (product + regional availability)
// and one price list per brand; there is no paging, so each brand is one complete scope.
export const DINAMIK_HOST = "dinamikapp-api.dinamik.online";
export const DINAMIK_COMPANY = "DINAMIK";
export const DINAMIK_WAREHOUSE = "ALL";
export const dinamikBrandPattern = /^[\p{Lu}\p{N}][\p{Lu}\p{N} .&+/_-]{0,59}$/u;
const DINAMIK_LOCK = 3;

// The server omits its intermediate certificate. Pinning the issuer keeps TLS verification on
// (root: Sectigo Public Server Authentication Root R46, from the system/Node trust store).
// Source: http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt, valid until 2036-03-21,
// SHA-256 8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0.
const SECTIGO_DV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

const brandListSchema = z.array(z.object({ brand: z.string() }).passthrough());
const stockRowSchema = z.object({
  stokKodu: z.string().min(1), marka: z.string(), stokAdi: z.string().nullable(), fiyat: z.number().finite().nullable(),
  varyok1: z.string().nullable(), varyok2: z.string().nullable(), varyok3: z.string().nullable(), varyok4: z.string().nullable(),
}).passthrough();
const priceRowSchema = z.object({ stokKodu: z.string().min(1), marka: z.string(), fiyat: z.number().finite().nullable() }).passthrough();
// Fields of a stock-list row that describe availability or price rather than the product itself.
const stockFields = ["varyok1", "varyok2", "varyok3", "varyok4", "varyokAll", "kaporta"] as const;
const offerFields = ["fiyat", "kampanyaOrani"] as const;

export const dinamikImportOptions = z.object({
  brand: z.string().regex(dinamikBrandPattern),
  acceptAnomaly: z.string().trim().min(10).max(500).optional(),
});

export class DinamikImportError extends Error {
  constructor(public readonly reason: "busy" | "upstream" | "contract" | "config" | "rejected", public readonly detail?: string) {
    super(`Dinamik: ${reason}${detail ? ` (${detail})` : ""}`);
  }
}

export type DinamikFetch = (path: string) => Promise<unknown>;

/**
 * Production egress is the VPS address Dinamik allow-lists. Local development can reach the API
 * through `ssh -N -L 18443:dinamikapp-api.dinamik.online:443 root@<vps>` with
 * DINAMIK_DIRECT_TUNNEL=127.0.0.1:18443; SNI, certificate check and Host header keep the real name.
 */
export function dinamikClient(): DinamikFetch {
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new DinamikImportError("config", key);
    return value;
  };
  let base: URL;
  try { base = new URL(required("DINAMIK_BASE")); }
  catch (error) { throw error instanceof DinamikImportError ? error : new DinamikImportError("config", "DINAMIK_BASE"); }
  if (base.protocol !== "https:" || base.hostname !== DINAMIK_HOST || base.username || base.password || (base.port && base.port !== "443")) throw new DinamikImportError("config", "DINAMIK_BASE");
  const apiKey = required("DINAMIK_APIKEY"), secretKey = required("DINAMIK_SECRETKEY");
  const tunnel = process.env.DINAMIK_DIRECT_TUNNEL?.trim().match(/^(127\.0\.0\.1|localhost):(\d{2,5})$/);
  if (process.env.DINAMIK_DIRECT_TUNNEL?.trim() && !tunnel) throw new DinamikImportError("config", "DINAMIK_DIRECT_TUNNEL");
  const ca = [...rootCertificates, SECTIGO_DV_R36];
  return path => new Promise((resolve, reject) => {
    const req = request({
      host: tunnel?.[1] ?? DINAMIK_HOST, port: tunnel ? Number(tunnel[2]) : 443, servername: DINAMIK_HOST, ca,
      path: `/api/Dnmk_Customer/${path}`, method: "GET", timeout: 120_000,
      headers: { Host: DINAMIK_HOST, Accept: "application/json", ApiKey: apiKey, SecretKey: secretKey },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        // The largest brand (BOSCH stock) is ~8 MB; anything far larger is not a normal list.
        if (size > 128 * 1024 * 1024) req.destroy(new DinamikImportError("upstream", `${path.split("/")[0]} oversized`));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        const name = path.split("/")[0];
        if (response.statusCode !== 200) return reject(new DinamikImportError("upstream", `${name} HTTP ${response.statusCode}`));
        if (!String(response.headers["content-type"] ?? "").includes("application/json")) return reject(new DinamikImportError("contract", `${name} content-type`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new DinamikImportError("contract", `${name} JSON`)); }
      });
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchDinamikBrands(fetchJson: DinamikFetch = dinamikClient()) {
  const brands = [...new Set(brandListSchema.parse(await fetchJson("getBrandList")).map(row => row.brand.trim()).filter(Boolean))];
  if (!brands.length) throw new DinamikImportError("contract", "empty brand list");
  return brands.sort();
}

function pick(row: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]));
}

function omit(row: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key) && key !== "$type"));
}

/**
 * The price list covers every sold code; the stock list is the subset carrying product details and
 * regional VAR/YOK flags (istanbul/ankara/sakarya/kayseri — availability, not quantities).
 * A code only in the price list keeps product_data minimal and stock_data null; nothing is invented.
 */
export function prepareDinamikImport(input: { brand: string; stock: unknown; prices: unknown }) {
  const stock = z.array(stockRowSchema).parse(input.stock);
  const prices = z.array(priceRowSchema).parse(input.prices);
  type Entry<T> = { value: T; count: number; variants: T[] };
  const index = <T extends { stokKodu: string }>(rows: T[]) => {
    const map = new Map<string, Entry<T>>();
    for (const row of rows) {
      const code = row.stokKodu.trim(), previous = map.get(code);
      if (!previous) map.set(code, { value: row, count: 1, variants: [row] });
      else {
        previous.count++;
        if (!previous.variants.some(variant => JSON.stringify(variant) === JSON.stringify(row))) previous.variants.push(row);
      }
    }
    return map;
  };
  const s = index(stock), p = index(prices);
  const codes = [...new Set([...p.keys(), ...s.keys()])].sort();
  const items: ObservationItem[] = codes.map(code => {
    const st = s.get(code), pr = p.get(code);
    const stockRow = st?.value as Record<string, unknown> | undefined;
    const priceRow = pr?.value as Record<string, unknown> | undefined;
    // Both lists quote a price; a disagreement is kept visible instead of picking one.
    const priceMismatch = Boolean(st && pr && st.value.fiyat !== pr.value.fiyat);
    const conflicting = (st?.variants.length ?? 0) > 1 || (pr?.variants.length ?? 0) > 1 || priceMismatch;
    return {
      code,
      product_data: stockRow ? omit(stockRow, [...stockFields, ...offerFields]) : { stokKodu: code, marka: priceRow!.marka },
      price_data: priceRow ? { ...omit(priceRow, []), ...(stockRow && "kampanyaOrani" in stockRow ? { kampanyaOrani: stockRow.kampanyaOrani } : {}) } : null,
      stock_data: stockRow ? pick(stockRow, stockFields) : null,
      product_count: Math.max(st?.count ?? 0, pr?.count ?? 0), price_count: pr?.count ?? 0, stock_count: st?.count ?? 0,
      conflicting,
      source_variants: {
        ...((st?.variants.length ?? 0) > 1 ? { stocks: st!.variants } : {}),
        ...((pr?.variants.length ?? 0) > 1 ? { prices: pr!.variants } : {}),
        ...(priceMismatch ? { stockListPrice: st!.value.fiyat } : {}),
      },
    };
  });
  return { items, quality: {
    stockRows: stock.length, priceRows: prices.length, uniqueProducts: items.length,
    missingPrices: items.filter(i => i.price_data?.fiyat == null).length,
    missingStocks: items.filter(i => !i.stock_data).length,
    duplicateCodes: items.filter(i => i.price_count > 1 || i.stock_count > 1).length,
    conflictingCodes: items.filter(i => i.conflicting).length,
    available: items.filter(i => i.stock_data && Object.values(i.stock_data).includes("VAR")).length,
    foreignBrandRows: [...stock, ...prices].filter(row => row.marka.trim() !== input.brand).length,
  } };
}

/** Adds newly listed brands as enabled scopes and disables brands Dinamik no longer lists. */
export async function discoverDinamikBrands(pool: Pool, fetchJson: DinamikFetch = dinamikClient()) {
  const brands = await fetchDinamikBrands(fetchJson);
  const invalid = brands.filter(brand => !dinamikBrandPattern.test(brand));
  const valid = brands.filter(brand => dinamikBrandPattern.test(brand));
  const added = await pool.query<{ list_group: string }>(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,daily_at,stale_minutes,next_run_at)
    SELECT 'dinamik',$1,brand,$2,true,'04:00',2160,now() FROM unnest($3::text[]) brand
    ON CONFLICT(supplier,company,list_group,warehouse) DO NOTHING RETURNING list_group`, [DINAMIK_COMPANY, DINAMIK_WAREHOUSE, valid]);
  const removed = await pool.query<{ list_group: string }>(`UPDATE supplier_sync_scopes SET enabled=false
    WHERE supplier='dinamik' AND company=$1 AND warehouse=$2 AND enabled AND NOT list_group=ANY($3::text[]) RETURNING list_group`, [DINAMIK_COMPANY, DINAMIK_WAREHOUSE, valid]);
  await pool.query(`INSERT INTO supplier_discovery(supplier,checked_at,listed) VALUES('dinamik',now(),$1)
    ON CONFLICT(supplier) DO UPDATE SET checked_at=EXCLUDED.checked_at,listed=EXCLUDED.listed`, [brands.length]);
  return { listed: brands.length, added: added.rows.map(r => r.list_group), disabled: removed.rows.map(r => r.list_group), invalid };
}

export async function importDinamik(pool: Pool, options: z.input<typeof dinamikImportOptions>, fetchJson?: DinamikFetch) {
  const { brand, acceptAnomaly } = dinamikImportOptions.parse(options);
  const company = DINAMIK_COMPANY, warehouse = DINAMIK_WAREHOUSE;
  const connection = await pool.connect();
  let locked = false, inTransaction = false, stage = "Bağlantı", runId: string | undefined;
  const observations: Record<string, string> = {};
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock(20261001,$1) AS locked", [DINAMIK_LOCK])).rows[0].locked;
    if (!locked) throw new DinamikImportError("busy");
    runId = (await connection.query<{ id: string }>(
      `INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,status,observations,quality,groups_data,currencies_data,run_kind)
       VALUES('dinamik',$1,$2,$3,clock_timestamp(),'running','{}','{}','{}','{}','full') RETURNING id`, [company, brand, warehouse],
    )).rows[0].id;
    // Holding the Dinamik lock proves older running records have lost their worker.
    await connection.query(`UPDATE supplier_imports SET status='failed',completed_at=clock_timestamp(),error_reason='worker-interrupted'
      WHERE supplier='dinamik' AND status='running' AND id<>$1`, [runId]);
    stage = "Config";
    const get = fetchJson ?? dinamikClient();
    const encoded = encodeURIComponent(brand);
    stage = "getStockList";
    const stock = await get(`getStockList/${encoded}`);
    observations.getStockList = new Date().toISOString();
    stage = "getPriceList";
    const prices = await get(`getPriceList/${encoded}`);
    observations.getPriceList = new Date().toISOString();
    stage = "Contract";
    const prepared = prepareDinamikImport({ brand, stock, prices });
    stage = "DB";
    await connection.query("BEGIN"); inTransaction = true;
    const previous = (await connection.query<{ quality: typeof prepared.quality }>(
      `SELECT quality FROM supplier_imports WHERE supplier='dinamik' AND company=$1 AND list_group=$2 AND warehouse=$3
       AND status='succeeded' AND (quality->>'uniqueProducts')::int>0 ORDER BY completed_at DESC,id DESC LIMIT 1`, [company, brand, warehouse],
    )).rows[0]?.quality;
    const observedAt = new Date();
    let stats = { added: 0, changed: 0, unchanged: 0, missing: 0, inactive: 0, restored: 0 };
    // A brand that never had products may legitimately list nothing; one that had them may not silently empty.
    if (prepared.items.length || previous) {
      const rejection = rejectionReason(prepared.quality, previous);
      if (rejection && !acceptAnomaly) {
        await connection.query("ROLLBACK"); inTransaction = false;
        await connection.query("UPDATE supplier_imports SET quality=$2,observations=$3,error_reason=$4 WHERE id=$1",
          [runId, JSON.stringify(prepared.quality), JSON.stringify(observations), rejection]);
        throw new DinamikImportError("rejected", rejection);
      }
      if (prepared.items.length) stats = await applySupplierSnapshot(connection, { supplier: "dinamik", company, group: brand, warehouse }, runId, prepared.items, observedAt, true);
    }
    await connection.query(`UPDATE supplier_imports SET status='succeeded',completed_at=$2,observations=$3,quality=$4,stats=$5,review_note=$6 WHERE id=$1`,
      [runId, observedAt, JSON.stringify(observations), JSON.stringify(prepared.quality), JSON.stringify(stats), acceptAnomaly ?? null]);
    await connection.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,daily_at,stale_minutes,last_success_at,next_run_at)
      VALUES('dinamik',$1,$2,$3,true,'04:00',2160,$4,((($4::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+time '04:00') AT TIME ZONE 'Europe/Istanbul')
      ON CONFLICT(supplier,company,list_group,warehouse) DO UPDATE SET last_success_at=$4,consecutive_failures=0,next_run_at=CASE WHEN supplier_sync_scopes.interval_minutes=1440 THEN
        ((($4::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+supplier_sync_scopes.daily_at) AT TIME ZONE 'Europe/Istanbul'
        ELSE $4::timestamptz+supplier_sync_scopes.interval_minutes*interval '1 minute' END`, [company, brand, warehouse, observedAt]);
    await connection.query("COMMIT"); inTransaction = false;
    return { id: runId, ...prepared.quality, stats };
  } catch (error) {
    if (inTransaction) await connection.query("ROLLBACK");
    const reason = error instanceof DinamikImportError ? error.reason : error instanceof z.ZodError ? "contract" : "upstream";
    if (runId) {
      // Persist only controlled diagnostics, never response bodies, keys or raw exception messages.
      const diagnostic = error instanceof Error && error.name === "TimeoutError" ? "timeout"
        : error instanceof DinamikImportError ? error.detail?.match(/HTTP \d{3}$/)?.[0] : undefined;
      await connection.query(`UPDATE supplier_imports SET status=$2,completed_at=clock_timestamp(),observations=$3,
        error_reason=COALESCE(error_reason,$4) WHERE id=$1`, [runId, reason === "rejected" ? "rejected" : "failed", JSON.stringify(observations), `${reason}: ${stage}${diagnostic ? `: ${diagnostic}` : ""}`]);
      await connection.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,daily_at,stale_minutes,consecutive_failures,next_run_at)
        VALUES('dinamik',$1,$2,$3,true,'04:00',2160,1,now()+interval '15 minutes') ON CONFLICT(supplier,company,list_group,warehouse)
        DO UPDATE SET consecutive_failures=supplier_sync_scopes.consecutive_failures+1,
        next_run_at=now()+LEAST(360,15*power(2,LEAST(supplier_sync_scopes.consecutive_failures,5))) * interval '1 minute'`, [company, brand, warehouse]);
    }
    if (error instanceof DinamikImportError) throw error;
    if (error instanceof z.ZodError) throw new DinamikImportError("contract", stage);
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{5,40}$/.test(error.code) ? ` ${error.code}` : "";
    throw new DinamikImportError("upstream", `${stage}${code}`);
  } finally {
    try { if (locked) await connection.query("SELECT pg_advisory_unlock(20261001,$1)", [DINAMIK_LOCK]); }
    finally { connection.release(); }
  }
}
