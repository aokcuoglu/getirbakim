import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

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

main().catch((error: unknown) => {
  // Avoid leaking credentials or response bodies through exception messages.
  console.error(error instanceof InspectionError ? error.message : "Başbuğ incelemesi tamamlanamadı. Ortam alanlarını, servis erişimini ve FirmaAdi/grup/depo/ürün kodunu kontrol edin.");
  process.exitCode = 1;
});
