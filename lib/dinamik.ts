import "server-only";
import { ProxyAgent } from "undici";

const DEFAULT_TIMEOUT_MS = 30_000;
const REQUIRE_PROXY_BY_DEFAULT = true;

let proxyInitialized = false;
let proxyAgent: ProxyAgent | null | undefined;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function initProxyOnce() {
  if (proxyInitialized) return;

  const proxyUrl = process.env.DINAMIK_PROXY_URL?.trim();
  const proxyRequired = parseBool(
    process.env.DINAMIK_PROXY_REQUIRED,
    REQUIRE_PROXY_BY_DEFAULT
  );

  if (proxyRequired && !proxyUrl) {
    throw new Error(
      "DINAMIK_PROXY_URL is required. Set VPS proxy URL or set DINAMIK_PROXY_REQUIRED=false for local direct access."
    );
  }

  if (proxyUrl) {
    if (proxyUrl.includes("DATABASE_URL=") || proxyUrl.includes("DIRECT_URL=")) {
      throw new Error(
        "DINAMIK_PROXY_URL is malformed. Check .env.local for a missing newline after the proxy URL."
      );
    }

    try {
      proxyAgent = new ProxyAgent(proxyUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid DINAMIK_PROXY_URL: ${message}`);
    }
  } else {
    proxyAgent = null;
  }

  proxyInitialized = true;
}

type UndiciRequestInit = RequestInit & {
  dispatcher?: ProxyAgent;
};

function withProxyDispatcher(init: RequestInit): UndiciRequestInit {
  initProxyOnce();
  const requestInit: UndiciRequestInit = { ...init };
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

type DinamikFetchOptions = {
  timeoutMs?: number;
};

export async function proxiedFetch(url: string, init: RequestInit = {}) {
  return fetch(url, withProxyDispatcher({ ...init, cache: "no-store" }));
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

  const headers = new Headers(requestInit.headers);
  headers.set("ApiKey", process.env.DINAMIK_APIKEY || "");
  headers.set("SecretKey", process.env.DINAMIK_SECRETKEY || "");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  return fetch(url, {
    ...requestInit,
    headers,
    signal,
    cache: "no-store",
  });
}
