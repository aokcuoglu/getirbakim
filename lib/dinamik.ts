import "server-only";
import {
  fetch as undiciFetch,
  ProxyAgent,
  type RequestInit as UndiciRequestInit,
} from "undici";
export type DinamikProxyDiagnostics = {
  required: boolean
  configured: boolean
  proxyHost: string | null
  proxyPort: number | null
  proxyUser: string | null
  setupError: string | null
}

const DEFAULT_TIMEOUT_MS = 30_000;
const REQUIRE_PROXY_BY_DEFAULT = true;

let proxyInitialized = false;
let proxyAgent: ProxyAgent | null | undefined;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readProxyUrl(): string | undefined {
  return process.env.DINAMIK_PROXY_URL?.trim() || undefined;
}

function isProxyRequired(): boolean {
  return parseBool(process.env.DINAMIK_PROXY_REQUIRED, REQUIRE_PROXY_BY_DEFAULT);
}

/** Safe summary for admin UI — never exposes proxy password. */
export function getDinamikProxyDiagnostics(): DinamikProxyDiagnostics {
  const required = isProxyRequired();
  const proxyUrl = readProxyUrl();

  if (!proxyUrl) {
    return {
      required,
      configured: false,
      proxyHost: null,
      proxyPort: null,
      proxyUser: null,
      setupError: required
        ? "DINAMIK_PROXY_URL tanımlı değil. VPS Squid proxy adresini .env dosyasına ekleyin."
        : null,
    };
  }

  try {
    const parsed = new URL(proxyUrl);
    return {
      required,
      configured: true,
      proxyHost: parsed.hostname,
      proxyPort: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
      proxyUser: parsed.username || null,
      setupError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      required,
      configured: false,
      proxyHost: null,
      proxyPort: null,
      proxyUser: null,
      setupError: `DINAMIK_PROXY_URL geçersiz: ${message}`,
    };
  }
}

function initProxyOnce() {
  if (proxyInitialized) return;

  const proxyUrl = readProxyUrl();
  const proxyRequired = isProxyRequired();

  if (proxyRequired && !proxyUrl) {
    throw new Error(
      "DINAMIK_PROXY_URL is required. Örnek: http://dinamik:SIFRE@173.249.36.2:8888 — veya yerel geliştirmede DINAMIK_PROXY_REQUIRED=false"
    );
  }

  if (proxyUrl) {
    if (proxyUrl.includes("DATABASE_URL=") || proxyUrl.includes("DIRECT_URL=")) {
      throw new Error(
        "DINAMIK_PROXY_URL is malformed. Check .env.local for a missing newline after the proxy URL."
      );
    }

    try {
      const allowInsecureTls = parseBool(
        process.env.DINAMIK_PROXY_TLS_INSECURE,
        false
      );
      proxyAgent = new ProxyAgent({
        uri: proxyUrl,
        ...(allowInsecureTls
          ? { requestTls: { rejectUnauthorized: false } }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid DINAMIK_PROXY_URL: ${message}`);
    }
  } else {
    proxyAgent = null;
  }

  proxyInitialized = true;
}

type DinamikRequestInit = UndiciRequestInit & {
  dispatcher?: ProxyAgent;
};

function withProxyDispatcher(init: RequestInit): DinamikRequestInit {
  initProxyOnce();
  const requestInit: DinamikRequestInit = { ...(init as UndiciRequestInit) };
  if (proxyAgent) requestInit.dispatcher = proxyAgent;
  return requestInit;
}

function validateDinamikEnv() {
  const missing: string[] = [];
  if (!process.env.DINAMIK_BASE) missing.push("DINAMIK_BASE");
  if (!process.env.DINAMIK_APIKEY) missing.push("DINAMIK_APIKEY");
  if (!process.env.DINAMIK_SECRETKEY) missing.push("DINAMIK_SECRETKEY");

  if (missing.length > 0) {
    throw new Error(`Missing Dinamik env vars: ${missing.join(", ")}`);
  }
}

function formatFetchError(error: unknown): string {
  const base =
    error instanceof Error ? error.message : "Dinamik isteği başarısız.";

  const diagnostics = getDinamikProxyDiagnostics();
  if (diagnostics.required && !diagnostics.configured) {
    return `${base} — Proxy yapılandırılmamış (DINAMIK_PROXY_URL).`;
  }

  const lower = base.toLowerCase();
  if (
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("connect") ||
    lower.includes("socket")
  ) {
    const via = diagnostics.configured
      ? `${diagnostics.proxyHost}:${diagnostics.proxyPort}`
      : "proxy yok";
    return `${base} — Dinamik API VPS IP whitelist kullanıyor; istekler ${via} üzerinden gitmeli. Squid/ufw ve .env proxy ayarını kontrol edin.`;
  }

  return base;
}

type DinamikFetchOptions = {
  timeoutMs?: number;
};

async function dinamikUndiciFetch(
  url: string,
  init: DinamikRequestInit
): Promise<Response> {
  try {
    const response = await undiciFetch(url, init as UndiciRequestInit);
    return response as unknown as Response;
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? `: ${error.cause.message}`
        : "";
    throw new Error(`${formatFetchError(error)}${cause}`);
  }
}

export async function proxiedFetch(url: string, init: RequestInit = {}) {
  return dinamikUndiciFetch(url, {
    ...withProxyDispatcher(init),
    cache: "no-store",
  });
}

export async function dinamikFetch(
  path: string,
  init: RequestInit = {},
  options: DinamikFetchOptions = {}
) {
  const requestInit = withProxyDispatcher(init);
  validateDinamikEnv();

  const base = process.env.DINAMIK_BASE!;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = requestInit.signal ?? AbortSignal.timeout(timeoutMs);
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(requestInit.headers as globalThis.HeadersInit);
  headers.set("ApiKey", process.env.DINAMIK_APIKEY || "");
  headers.set("SecretKey", process.env.DINAMIK_SECRETKEY || "");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const headerRecord: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerRecord[key] = value;
  });

  return dinamikUndiciFetch(url, {
    ...requestInit,
    headers: headerRecord,
    signal,
    cache: "no-store",
  });
}
