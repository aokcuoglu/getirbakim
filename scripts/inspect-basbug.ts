import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { BasbugImportError, basbugBase, basbugLogin, basbugPaused } from "../src/modules/suppliers/basbug-import";
import { supplierFetch } from "../src/modules/suppliers/egress-proxy";

class InspectionError extends Error {}

// Read-only exploration. Tokens stay in memory; response samples stay outside Git.
const authSchema = z.object({
  token: z.string().min(1),
  tokenTipi: z.literal("Bearer"),
  tokenBitisSuresi: z.number().positive(),
  refreshTokenBitisSuresi: z.number().positive(),
});

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} gerekli.`);
  return value;
}

function shape(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return { type: "array", count: value.length, sampleShape: value.length ? shape(value[0]) : null };
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]));
  return typeof value;
}

async function main() {
  const base = new URL(required("BASBUG_BASE_URL"));
  if (base.protocol !== "https:" || base.hostname !== "api.basbug.com.tr" || base.username || base.password) {
    throw new Error("Başbuğ için doğrulanmış HTTPS servis adresi gerekli.");
  }
  const response = await fetch(new URL("/auth/Login", base), {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      KullaniciAdi: required("BASBUG_USERNAME"), Parola: required("BASBUG_PASSWORD"),
      ClientID: required("BASBUG_CLIENT_ID"), ClientSecret: required("BASBUG_CLIENT_SECRET"),
    }),
  });
  if (!response.ok) throw new InspectionError(`Başbuğ Auth HTTP ${response.status}; yanıt gizlilik için yazdırılmadı.`);
  const auth = authSchema.parse(await response.json());
  console.log(JSON.stringify({ auth: "başarılı", tokenType: auth.tokenTipi, expiresInSeconds: auth.tokenBitisSuresi, refreshExpiresInSeconds: auth.refreshTokenBitisSuresi }));

  // Defaults come from the supplied Başbuğ Postman collection.
  const firma = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const code = process.env.BASBUG_SAMPLE_CODE || "COR 82016529";
  const group = process.env.BASBUG_SAMPLE_GROUP || "FIAT";
  const warehouse = process.env.BASBUG_SAMPLE_WAREHOUSE || "MRK";
  const bulkCodes = process.env.BASBUG_SAMPLE_CODES || "MAG 359002805240,MAG 359003410380";
  const endpoints: { path: string; params: Record<string, string>; file: string }[] = [
    { path: "/material/ListeGrubuGetir", params: { FirmaAdi: firma }, file: "groups" },
    { path: "/material/DovizBilgisiGetir", params: { FirmaAdi: firma }, file: "currency" },
    { path: "/material/MalzemeAra", params: { FirmaAdi: firma, MalzemeNo: code }, file: "search" },
    { path: "/material/MalzemeleriGetir", params: { FirmaAdi: firma, ListeGrubu: group }, file: "products" },
    { path: "/material/FiyatGetir", params: { FirmaAdi: firma, ListeGrubu: group }, file: "prices" },
    { path: "/material/StokGetir", params: { FirmaAdi: firma, ListeGrubu: group, Depo: warehouse }, file: "stock" },
    { path: "/material/TopluMalzemeAra", params: { FirmaAdi: firma, MalzemeListesi: bulkCodes }, file: "bulk" },
  ];
  for (const endpoint of endpoints) {
    const url = new URL(endpoint.path, base);
    url.search = new URLSearchParams(endpoint.params).toString();
    const result = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    if (!result.ok) throw new InspectionError(`${endpoint.path}: HTTP ${result.status}; yanıt gizlilik için yazdırılmadı.`);
    const data: unknown = await result.json();
    await mkdir(".local/basbug", { recursive: true, mode: 0o700 });
    await writeFile(`.local/basbug/${endpoint.file}.json`, JSON.stringify(data, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ endpoint: endpoint.path, status: result.status, shape: shape(data) }));
  }
}

type Depots = { depo?: unknown; stok?: unknown }[];

/**
 * `--bulk`: read-only comparison of TopluMalzemeAra with MalzemeAra (#787). Only these two GET paths are called, over
 * the app's own login and egress proxy. BASBUG_SAMPLE_CODES (comma separated): codes 1-3 have stock, code 4 has none,
 * the rest fill the 20-code request; codes with `/`, `.` or `+` among them go into the mixed request.
 */
async function bulkMain() {
  if (basbugPaused()) throw new InspectionError("Başbuğ istekleri duraklatılmış (.local/basbug-paused); çağrı yapılmadı.");
  const codes = (process.env.BASBUG_SAMPLE_CODES ?? "").split(",").map(code => code.trim()).filter(Boolean);
  if (codes.length < 20) throw new InspectionError("--bulk için BASBUG_SAMPLE_CODES en az 20 kod içermeli.");
  const firma = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const base = basbugBase();
  const { token } = await basbugLogin(base);
  console.log(JSON.stringify({ auth: "başarılı" }));
  await mkdir(".local/basbug", { recursive: true, mode: 0o700 });

  async function call(path: "/material/TopluMalzemeAra" | "/material/MalzemeAra", params: Record<string, string>) {
    const url = new URL(path, base);
    url.search = new URLSearchParams(params).toString();
    const started = performance.now();
    const response = await supplierFetch("basbug", url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    const ms = Math.round(performance.now() - started);
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: response.status, ms, data, text };
  }

  const bulkRows = (data: unknown) => {
    const list = (data as { malzemeListesi?: unknown } | undefined)?.malzemeListesi;
    return Array.isArray(list) ? list.map(row => {
      const item = row as { no?: unknown; nf?: unknown; sDepolar?: Depots };
      return { no: item.no, nf: item.nf, sDepolar: item.sDepolar };
    }) : undefined;
  };

  async function bulk(name: string, list: string[]) {
    const result = await call("/material/TopluMalzemeAra", { FirmaAdi: firma, MalzemeListesi: list.join(",") });
    if (result.data !== undefined) await writeFile(`.local/basbug/bulk-${name}.json`, JSON.stringify(result.data, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({
      scenario: name, endpoint: "TopluMalzemeAra", requested: list, status: result.status, ms: result.ms,
      ...(result.status === 200 ? { shape: shape(result.data), rows: bulkRows(result.data) } : { body: result.text.slice(0, 200) }),
    }));
    return result;
  }

  async function single(name: string, code: string) {
    const result = await call("/material/MalzemeAra", { FirmaAdi: firma, MalzemeNo: code });
    const item = result.data as Record<string, unknown> | undefined;
    console.log(JSON.stringify({
      scenario: name, endpoint: "MalzemeAra", code, status: result.status, ms: result.ms,
      ...(result.status === 200 && item ? { no: item.no, nf: item.nf, sMrk: item.sMrk, sIzm: item.sIzm, sAnk: item.sAnk, sAdn: item.sAdn, sErz: item.sErz } : { body: result.text.slice(0, 200) }),
    }));
    return result;
  }

  const [a, b, c, empty] = codes;
  // G1: the fewest codes the call accepts.
  await bulk("g1-1", [a]);
  await bulk("g1-2", [a, b]);
  await bulk("g1-3", [a, b, c]);
  // G2: an unknown code next to known ones.
  await bulk("g2-unknown", [a, b, "ZZZ 000000"]);
  // G3: the code without its spaces.
  await bulk("g3-compact", [a.replace(/\s+/g, ""), b]);
  // G5: 20 codes in one call.
  await bulk("g5-twenty", codes.slice(0, 20));
  // G6: list groups and `/`, `.`, `+` mixed, one code twice.
  const special = codes.filter(code => /[/.+]/.test(code)).slice(0, 4);
  await bulk("g6-mixed", [...special, empty, a, a]);
  // G4 + G7: the same four codes in one bulk call and in four parallel MalzemeAra calls, then the bulk call again.
  const four = [a, b, c, empty];
  const bulkFirst = await bulk("g7-bulk", four);
  const started = performance.now();
  await Promise.all(four.map(code => single("g7-single", code)));
  const parallelMs = Math.round(performance.now() - started);
  const bulkSecond = await bulk("g7-bulk-again", four);
  console.log(JSON.stringify({ scenario: "g7-summary", bulkMs: [bulkFirst.ms, bulkSecond.ms], parallelSingleMs: parallelMs }));
}

const run = process.argv.includes("--bulk") ? bulkMain : main;

run().catch((error: unknown) => {
  // Avoid leaking credentials or response bodies through exception messages.
  // BasbugImportError carries only a reason and an HTTP status; network errors carry only their code.
  if (error instanceof BasbugImportError || error instanceof InspectionError) console.error(error.message);
  else if (process.argv.includes("--bulk") && error instanceof Error) {
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    console.error(`Başbuğ isteği başarısız: ${error.name}${typeof code === "string" ? ` (${code})` : ""}`);
  } else console.error("Başbuğ incelemesi tamamlanamadı. Ortam alanlarını, servis erişimini ve FirmaAdi/grup/depo/ürün kodunu kontrol edin.");
  process.exitCode = 1;
});
