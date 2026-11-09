import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { connect as netConnect, createServer as createNetServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import { DinamikImportError, DINAMIK_HOST, dinamikClient } from "../src/modules/suppliers/dinamik-import";
import { EgressProxyError, egressProxyFor, openTunnel, supplierFetch } from "../src/modules/suppliers/egress-proxy";

const listen = (server: Server | ReturnType<typeof createHttpServer>) => new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const close = (server: Server | ReturnType<typeof createHttpServer>) => new Promise<void>(resolve => server.close(() => resolve()));

type Seen = { method: string; target: string; authorization?: string };

/** CONNECT proxy that records requests and forwards tunnels to `forwardPort` (or answers `status`). */
function startProxy(options: { forwardPort?: number | ((target: string) => number | undefined); status?: number; onRequest?: (req: IncomingMessage, res: import("node:http").ServerResponse) => void }) {
  const seen: Seen[] = [];
  const server = createHttpServer((req, res) => {
    seen.push({ method: req.method ?? "", target: req.url ?? "", authorization: req.headers["proxy-authorization"] });
    if (options.onRequest) options.onRequest(req, res);
    else res.writeHead(502).end();
  });
  server.on("connect", (req, client, head) => {
    seen.push({ method: "CONNECT", target: req.url ?? "", authorization: req.headers["proxy-authorization"] });
    const forwardPort = typeof options.forwardPort === "function" ? options.forwardPort(req.url ?? "") : options.forwardPort;
    if (!forwardPort) {
      client.end(`HTTP/1.1 ${options.status ?? 403} Forbidden\r\nX-Echo: ${req.headers["proxy-authorization"] ?? ""}\r\n\r\n`);
      return;
    }
    const upstream = netConnect(forwardPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client).pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  return { server, seen };
}

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

test("proxy settings: off by default, Dinamik only unless listed, strict URL", () => {
  assert.equal(egressProxyFor("dinamik", {}), undefined);
  const env = { SUPPLIER_EGRESS_PROXY: "http://getir%40bakim:p%3Ass@10.0.0.5:3128" };
  assert.deepEqual(egressProxyFor("dinamik", env), { url: "http://10.0.0.5:3128", host: "10.0.0.5", port: 3128, authorization: basic("getir@bakim", "p:ss") });
  assert.equal(egressProxyFor("basbug", env), undefined);
  assert.equal(egressProxyFor("basbug", { ...env, SUPPLIER_EGRESS_PROXY_FOR: " Dinamik , basbug " })?.port, 3128);
  assert.equal(egressProxyFor("seta", { ...env, SUPPLIER_EGRESS_PROXY_FOR: "dinamik,basbug" }), undefined);
  assert.equal(egressProxyFor("dinamik", { SUPPLIER_EGRESS_PROXY: "http://proxy.example:8888" })?.authorization, undefined);
  for (const bad of ["https://10.0.0.5:3128", "http://10.0.0.5", "http://10.0.0.5:3128/x", "http://user@10.0.0.5:3128", "socks5://10.0.0.5:1080", "not a url"]) {
    assert.throws(() => egressProxyFor("dinamik", { SUPPLIER_EGRESS_PROXY: bad }), EgressProxyError, bad);
  }
  assert.throws(() => egressProxyFor("dinamik", { ...env, SUPPLIER_EGRESS_PROXY_FOR: "dinamik,tami" }), EgressProxyError);
});

test("tunnel: CONNECT with credentials, then a raw byte stream", async () => {
  const echo = createNetServer(socket => socket.pipe(socket));
  const echoPort = await listen(echo);
  const { server, seen } = startProxy({ forwardPort: echoPort });
  const port = await listen(server);
  try {
    const socket = await openTunnel({ url: `http://127.0.0.1:${port}`, host: "127.0.0.1", port, authorization: basic("u", "p") }, "api.basbug.com.tr", 443);
    const reply = await new Promise<string>(resolve => { socket.once("data", data => resolve(data.toString())); socket.write("ping"); });
    socket.destroy();
    assert.equal(reply, "ping");
    assert.deepEqual(seen, [{ method: "CONNECT", target: "api.basbug.com.tr:443", authorization: basic("u", "p") }]);
  } finally { await close(server); await close(echo); }
});

test("tunnel: a refused CONNECT fails without echoing the proxy response", async () => {
  const { server } = startProxy({ status: 407 });
  const port = await listen(server);
  try {
    await assert.rejects(openTunnel({ url: "", host: "127.0.0.1", port, authorization: basic("u", "secret") }, "x.example", 443),
      (error: Error) => error.message === "egress proxy CONNECT HTTP 407" && !error.message.includes("secret"));
  } finally { await close(server); }
});

test("Dinamik through the proxy keeps TLS verification, SNI and Host end to end", async t => {
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), "egress-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${DINAMIK_HOST}`,
      "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
  } catch { t.skip("openssl not available"); return; }
  let servername: string | undefined;
  const tls = createTlsServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")),
    SNICallback: (name, callback) => { servername = name; callback(null); } }, socket => socket.end());
  tls.on("tlsClientError", () => {});
  tls.on("secureConnection", () => {});
  const tlsPort = await listen(tls);
  const { server, seen } = startProxy({ forwardPort: tlsPort });
  const port = await listen(server);
  const keys = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY", "DINAMIK_DIRECT_TUNNEL", "SUPPLIER_EGRESS_PROXY", "SUPPLIER_EGRESS_PROXY_FOR"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DINAMIK_BASE: `https://${DINAMIK_HOST}`, DINAMIK_APIKEY: "k", DINAMIK_SECRETKEY: "s", SUPPLIER_EGRESS_PROXY: `http://getir:bakim@127.0.0.1:${port}` });
  delete process.env.DINAMIK_DIRECT_TUNNEL; delete process.env.SUPPLIER_EGRESS_PROXY_FOR;
  try {
    // A self-signed certificate for the real name must still be rejected: verification is not relaxed.
    await assert.rejects(dinamikClient()("getBrandList"), (error: NodeJS.ErrnoException) => /SELF_SIGNED|UNABLE_TO_VERIFY|self[- ]signed/i.test(`${error.code} ${error.message}`));
    assert.deepEqual(seen, [{ method: "CONNECT", target: `${DINAMIK_HOST}:443`, authorization: basic("getir", "bakim") }]);
    assert.equal(servername, DINAMIK_HOST);
    process.env.DINAMIK_DIRECT_TUNNEL = "127.0.0.1:18443";
    assert.throws(() => dinamikClient(), (error: DinamikImportError) => error.reason === "config");
    delete process.env.DINAMIK_DIRECT_TUNNEL;
    process.env.SUPPLIER_EGRESS_PROXY = "https://127.0.0.1:1";
    assert.throws(() => dinamikClient(), (error: DinamikImportError) => error.reason === "config" && error.detail === "SUPPLIER_EGRESS_PROXY");
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    await close(server); await close(tls); rmSync(dir, { recursive: true, force: true });
  }
});

test("supplierFetch routes only the selected suppliers through the proxy", async () => {
  const http = createHttpServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'); });
  const httpPort = await listen(http);
  const { server, seen } = startProxy({ forwardPort: target => target === "supplier.test:80" ? httpPort : undefined, status: 403 });
  const port = await listen(server);
  const saved = { proxy: process.env.SUPPLIER_EGRESS_PROXY, list: process.env.SUPPLIER_EGRESS_PROXY_FOR };
  const originalFetch = globalThis.fetch;
  process.env.SUPPLIER_EGRESS_PROXY = `http://getir:bakim@127.0.0.1:${port}`;
  process.env.SUPPLIER_EGRESS_PROXY_FOR = "basbug";
  try {
    // HTTPS: CONNECT to the supplier host; the proxy refuses here, so the request fails.
    await assert.rejects(supplierFetch("basbug", "https://api.basbug.com.tr/auth/Login", { method: "POST", cache: "no-store", redirect: "error" }));
    assert.deepEqual(seen.at(-1), { method: "CONNECT", target: "api.basbug.com.tr:443", authorization: basic("getir", "bakim") });
    // The same request options work through the proxy end to end.
    const response = await supplierFetch("basbug", "http://supplier.test/products", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(seen.at(-1), { method: "CONNECT", target: "supplier.test:80", authorization: basic("getir", "bakim") });
    // Not selected: Node's fetch, direct.
    let direct = "";
    globalThis.fetch = (async (input: URL | RequestInfo) => { direct = String(input); return new Response("{}"); }) as typeof fetch;
    await supplierFetch("seta", "https://b2b-api.ismyazilim.com/seta/products");
    assert.equal(direct, "https://b2b-api.ismyazilim.com/seta/products");
    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (saved.proxy === undefined) delete process.env.SUPPLIER_EGRESS_PROXY; else process.env.SUPPLIER_EGRESS_PROXY = saved.proxy;
    if (saved.list === undefined) delete process.env.SUPPLIER_EGRESS_PROXY_FOR; else process.env.SUPPLIER_EGRESS_PROXY_FOR = saved.list;
    server.closeAllConnections(); http.closeAllConnections(); await close(server); await close(http);
  }
});
