import { Agent as HttpsAgent, type RequestOptions } from "node:https";
import type { Duplex } from "node:stream";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import { fetch as undiciFetch, ProxyAgent } from "undici";

/**
 * Supplier APIs that allow-list the Contabo VPS address are reached through a forward proxy on that
 * VPS while the application runs elsewhere (AWS, #411). HTTPS is tunnelled with HTTP CONNECT, so the
 * proxy sees only the target host; certificate verification, SNI and Host stay end to end.
 *
 * SUPPLIER_EGRESS_PROXY=http://user:password@host:port   (unset: direct connections, as before)
 * SUPPLIER_EGRESS_PROXY_FOR=dinamik,basbug,seta           (default: dinamik)
 * Payment (TAMI) calls never use it.
 */
export const egressSuppliers = ["dinamik", "basbug", "seta"] as const;
export type EgressSupplier = typeof egressSuppliers[number];
export type EgressProxy = { url: string; host: string; port: number; authorization?: string };

export class EgressProxyError extends Error {
  constructor(public readonly setting: string) {
    super(`Invalid ${setting}`);
    this.name = "EgressProxyError";
  }
}

const CONNECT_TIMEOUT_MS = 20_000;

export function egressProxyFor(supplier: EgressSupplier, env: Record<string, string | undefined> = process.env): EgressProxy | undefined {
  const raw = env.SUPPLIER_EGRESS_PROXY?.trim();
  if (!raw) return undefined;
  const selected = (env.SUPPLIER_EGRESS_PROXY_FOR?.trim() || "dinamik").split(",").map(name => name.trim().toLowerCase()).filter(Boolean);
  if (!selected.length || selected.some(name => !(egressSuppliers as readonly string[]).includes(name))) throw new EgressProxyError("SUPPLIER_EGRESS_PROXY_FOR");
  if (!selected.includes(supplier)) return undefined;
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new EgressProxyError("SUPPLIER_EGRESS_PROXY"); }
  // Plain HTTP to the proxy is enough: the supplier traffic inside the tunnel is TLS.
  if (url.protocol !== "http:" || !url.hostname || !url.port || (url.pathname && url.pathname !== "/") || url.search || url.hash) throw new EgressProxyError("SUPPLIER_EGRESS_PROXY");
  if (Boolean(url.username) !== Boolean(url.password)) throw new EgressProxyError("SUPPLIER_EGRESS_PROXY");
  const authorization = url.username
    ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`
    : undefined;
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return { url: `http://${url.host}`, host, port: Number(url.port), authorization };
}

/** Opens a raw TCP tunnel to host:port through the proxy (HTTP CONNECT). */
export function openTunnel(proxy: EgressProxy, host: string, port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxy.host, port: proxy.port });
    let head = Buffer.alloc(0);
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    socket.setTimeout(timeoutMs, () => fail(Object.assign(new Error("egress proxy timeout"), { name: "TimeoutError" })));
    socket.once("error", fail);
    socket.once("connect", () => {
      const target = `${host.includes(":") ? `[${host}]` : host}:${port}`;
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${proxy.authorization ? `Proxy-Authorization: ${proxy.authorization}\r\n` : ""}\r\n`);
    });
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > 16 * 1024) fail(new Error("egress proxy response too large"));
        return;
      }
      socket.off("data", onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.subarray(0, end).toString("latin1"))?.[1]);
      // Never echo the proxy response: it can carry the requested credentials back.
      if (status !== 200) return fail(new Error(`egress proxy CONNECT HTTP ${Number.isFinite(status) ? status : "invalid"}`));
      socket.setTimeout(0);
      socket.off("error", fail);
      const rest = head.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}

/** node:https agent whose connections run TLS inside a CONNECT tunnel (Dinamik's pinned-CA client). */
export class TunnelAgent extends HttpsAgent {
  constructor(private readonly proxy: EgressProxy) {
    super({ keepAlive: false });
  }

  override createConnection(options: RequestOptions, callback?: (error: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    const host = options.host ?? "localhost", port = Number(options.port ?? 443);
    const tls = options as ConnectionOptions;
    openTunnel(this.proxy, host, port).then(
      socket => callback?.(null, tlsConnect({ ...tls, socket, servername: tls.servername ?? host })),
      error => callback?.(error, undefined as unknown as Duplex),
    );
    return undefined;
  }
}

const dispatchers = new Map<string, ProxyAgent>();

function dispatcherFor(proxy: EgressProxy) {
  const key = `${proxy.url}\n${proxy.authorization ?? ""}`;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) {
    dispatcher = new ProxyAgent({ uri: proxy.url, token: proxy.authorization });
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

/** fetch for supplier APIs: direct unless this supplier is routed through SUPPLIER_EGRESS_PROXY. */
export function supplierFetch(supplier: EgressSupplier, input: URL | string, init: RequestInit = {}): Promise<Response> {
  const proxy = egressProxyFor(supplier);
  if (!proxy) return fetch(input, init);
  // undici's own fetch with its ProxyAgent: the dispatcher API of the npm package and of Node's
  // bundled fetch differ between major versions.
  return undiciFetch(input, { ...init, dispatcher: dispatcherFor(proxy) } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
