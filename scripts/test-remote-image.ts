import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, mock, test } from "node:test";
import { isPublicAddress, parseRemoteImageUrl, RemoteImageError, remoteImageName, remoteImageUrlMaxLength, type RemoteImageErrorReason } from "../src/modules/admin/remote-image-url";

// Admin "add image from URL" (#725): URL rules, the public-address check and the SSRF-safe fetch against a loopback
// fixture (only 127.0.0.1 is allowed here; the real check refuses it), then the server action's error messages.

describe("URL rules", () => {
  test("accepts http(s) URLs with a host", () => {
    for (const url of ["https://example.com/a.jpg", "http://example.com:8080/x", "https://[2606:4700::1]/a.png"]) assert.ok(parseRemoteImageUrl(url), url);
  });
  test("refuses other schemes, credentials, garbage and long URLs", () => {
    for (const url of ["", "ftp://example.com/a.jpg", "file:///etc/passwd", "javascript:alert(1)", "data:image/png;base64,AAAA",
      "https://user:pass@example.com/a.jpg", "https://user@example.com/a.jpg", "not a url", "//example.com/a.jpg",
      `https://example.com/${"a".repeat(remoteImageUrlMaxLength)}`]) assert.equal(parseRemoteImageUrl(url), null, url);
  });
  test("names the image after the last path segment", () => {
    assert.equal(remoteImageName(new URL("https://x.test/a/b/fren%20balatasi.jpg?w=1")), "fren balatasi.jpg");
    assert.equal(remoteImageName(new URL("https://x.test/")), "gorsel");
    assert.equal(remoteImageName(new URL("https://x.test/%E0%A4%A")), "%E0%A4%A");
  });
});

describe("public address check", () => {
  test("allows public unicast", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "100.63.255.255", "100.128.0.1", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e",
      "::ffff:8.8.8.8", "64:ff9b::808:808"]) assert.equal(isPublicAddress(ip), true, ip);
  });
  test("refuses private, loopback, link-local, CGNAT, multicast, reserved and mapped forms", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255",
      "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1",
      "255.255.255.255", "::", "::1", "fe80::1", "fe80::1%en0", "fc00::1", "fd12:3456::1", "ff02::1", "fec0::1", "::ffff:127.0.0.1",
      "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "::127.0.0.1", "2001:db8::1",
      "2001::1", "2002:7f00:1::", "100::1", "fd00:ec2::254", "localhost", "", "1.2.3", "999.1.1.1", "1:2:3"]) assert.equal(isPublicAddress(ip), false, ip);
  });
});

describe("fetch", () => {
  let server: Server;
  let base = "";
  let fetchRemoteImage: typeof import("../src/modules/admin/remote-image").fetchRemoteImage;
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const loopbackOnly = { allowAddress: (address: string) => address === "127.0.0.1", resolve: async () => [{ address: "127.0.0.1", family: 4 }] };
  const rejects = (promise: Promise<unknown>, reason: RemoteImageErrorReason) =>
    assert.rejects(promise, (error: unknown) => error instanceof RemoteImageError && error.reason === reason);

  before(async () => {
    ({ fetchRemoteImage } = await import("../src/modules/admin/remote-image"));
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/ua") return void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from(String(req.headers["user-agent"])));
      if (path.startsWith("/img/")) return void res.writeHead(200, { "content-type": "image/png; charset=binary" }).end(png);
      if (path === "/html") return void res.writeHead(200, { "content-type": "text/html" }).end("<p>hi</p>");
      if (path === "/svg") return void res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg/>");
      if (path === "/big-declared") return void res.writeHead(200, { "content-type": "image/jpeg", "content-length": "2048" }).end(Buffer.alloc(2048));
      if (path === "/big-stream") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        let sent = 0;
        const push = () => { while (sent < 4096 && res.write(Buffer.alloc(256))) sent += 256; if (sent < 4096) res.once("drain", push); else res.end(); };
        return void push();
      }
      if (path === "/missing") return void res.writeHead(404, { "content-type": "image/png" }).end();
      if (path === "/slow") return void setTimeout(() => res.writeHead(200, { "content-type": "image/png" }).end(png), 2000);
      if (path === "/to-img") return void res.writeHead(302, { location: "/img/redirected.png" }).end();
      if (path === "/to-private") return void res.writeHead(302, { location: "http://10.0.0.1/img/x.png" }).end();
      if (path === "/to-metadata") return void res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      if (path === "/to-file") return void res.writeHead(302, { location: "file:///etc/passwd" }).end();
      if (path === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
      res.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>(resolve => server.close(() => resolve())));

  test("downloads an image and names it after the path", async () => {
    const image = await fetchRemoteImage(`${base}/img/on%20disk.png`, loopbackOnly);
    assert.deepEqual(image.bytes, png);
    assert.equal(image.name, "on disk.png");
  });
  test("connects to the vetted address, not what the host name resolves to later", async () => {
    const image = await fetchRemoteImage(`http://images.example.test:${new URL(base).port}/img/a.png`, loopbackOnly);
    assert.deepEqual(image.bytes, png);
  });
  test("sends a neutral user agent", async () => {
    const image = await fetchRemoteImage(`${base}/ua`, loopbackOnly);
    assert.match(image.bytes.toString(), /^Mozilla\/5\.0 \(compatible; ImageFetcher\/1\.0\)$/);
  });
  test("refuses loopback with the real address check", () => rejects(fetchRemoteImage(`${base}/img/a.png`), "blocked"));
  test("refuses a host name that resolves to any blocked address", () =>
    rejects(fetchRemoteImage(`http://mixed.example.test:${new URL(base).port}/img/a.png`,
      { allowAddress: loopbackOnly.allowAddress, resolve: async () => [{ address: "127.0.0.1", family: 4 }, { address: "10.0.0.5", family: 4 }] }), "blocked"));
  test("refuses a URL that is not http(s)", () => rejects(fetchRemoteImage("file:///etc/passwd", loopbackOnly), "url"));
  test("refuses a non-image content type", async () => {
    await rejects(fetchRemoteImage(`${base}/html`, loopbackOnly), "not-image");
    await rejects(fetchRemoteImage(`${base}/svg`, loopbackOnly), "not-image");
  });
  test("refuses a body over the size cap, declared or streamed", async () => {
    await rejects(fetchRemoteImage(`${base}/big-declared`, { ...loopbackOnly, maxBytes: 1024 }), "size");
    await rejects(fetchRemoteImage(`${base}/big-stream`, { ...loopbackOnly, maxBytes: 1024 }), "size");
  });
  test("refuses an error status", () => rejects(fetchRemoteImage(`${base}/missing`, loopbackOnly), "status"));
  test("follows a redirect and re-checks it", async () => {
    const image = await fetchRemoteImage(`${base}/to-img`, loopbackOnly);
    assert.equal(image.name, "redirected.png");
    await rejects(fetchRemoteImage(`${base}/to-private`, loopbackOnly), "blocked");
    await rejects(fetchRemoteImage(`${base}/to-metadata`, loopbackOnly), "blocked");
    await rejects(fetchRemoteImage(`${base}/to-file`, loopbackOnly), "unreachable");
  });
  test("stops after three redirects", () => rejects(fetchRemoteImage(`${base}/loop`, loopbackOnly), "redirects"));
  test("times out", () => rejects(fetchRemoteImage(`${base}/slow`, { ...loopbackOnly, timeoutMs: 200 }), "timeout"));
  test("times out a hanging DNS lookup", () =>
    rejects(fetchRemoteImage("http://hang.example.test/a.png", { ...loopbackOnly, resolve: () => new Promise(() => undefined), timeoutMs: 100 }), "timeout"));
  test("reports an unreachable host", async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    await rejects(fetchRemoteImage(`http://127.0.0.1:${port}/a.png`, loopbackOnly), "unreachable");
    await rejects(fetchRemoteImage("http://nowhere.example.test/a.png", { ...loopbackOnly, resolve: async () => { throw new Error("ENOTFOUND"); } }), "unreachable");
  });
});

describe("server action", () => {
  const productId = "4f7c1b2e-8a3d-4c5e-9f10-1a2b3c4d5e6f";
  let next: () => Promise<{ bytes: Buffer; name: string }> = async () => ({ bytes: Buffer.alloc(1), name: "a.png" });
  let stored: { ok: true } | { ok: false; reason: string; image?: string } = { ok: true };
  const added: { productId: string; name: string }[] = [];
  let actions: typeof import("../src/app/yonetim/urunler/image-actions");

  before(async () => {
    mock.module("../src/modules/auth/session.ts", { namedExports: { requireAdmin: async () => ({ id: "admin-1" }) } });
    mock.module("../src/lib/db.ts", { namedExports: { db: {} } });
    mock.module("../src/modules/store/listing-epoch.ts", { namedExports: { invalidateListings: async () => undefined } });
    mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
    mock.module("../src/modules/admin/remote-image.ts", { namedExports: { fetchRemoteImage: () => next() } });
    mock.module("../src/modules/admin/product-image-store.ts", { namedExports: {
      addProductImage: async (_db: unknown, id: string, file: { name: string }) => { added.push({ productId: id, name: file.name }); return stored; },
    } });
    actions = await import("../src/app/yonetim/urunler/image-actions");
  });

  test("adds the downloaded image through the upload store", async () => {
    next = async () => ({ bytes: Buffer.alloc(1), name: "balata.jpg" });
    stored = { ok: true };
    assert.deepEqual(await actions.addProductImageFromUrl({ productId, url: " https://example.com/balata.jpg " }), { status: "success", message: "Görsel adresten eklendi." });
    assert.deepEqual(added.at(-1), { productId, name: "balata.jpg" });
  });
  test("refuses bad input before fetching", async () => {
    const count = added.length;
    assert.match((await actions.addProductImageFromUrl({ productId: "x", url: "https://example.com/a.jpg" })).message, /Sayfayı yenileyin/);
    assert.match((await actions.addProductImageFromUrl({ productId, url: "ftp://example.com/a.jpg" })).message, /http:\/\/ veya https:\/\//);
    assert.match((await actions.addProductImageFromUrl({ productId, url: "https://u:p@example.com/a.jpg" })).message, /http:\/\/ veya https:\/\//);
    assert.equal(added.length, count);
  });
  test("maps every download failure to a Turkish message", async () => {
    const expected: Record<RemoteImageErrorReason, RegExp> = {
      url: /görsel adresi girin/, blocked: /herkese açık adres/, unreachable: /ulaşılamadı/, timeout: /zamanında yanıt vermedi/,
      status: /döndürmedi/, "not-image": /bir görsel değil/, size: /en çok 8 MB/, redirects: /yönlendirme/,
    };
    for (const [reason, message] of Object.entries(expected) as [RemoteImageErrorReason, RegExp][]) {
      next = async () => { throw new RemoteImageError(reason); };
      const result = await actions.addProductImageFromUrl({ productId, url: "https://example.com/a.jpg" });
      assert.equal(result.status, "error", reason);
      assert.match(result.message, message, reason);
    }
  });
  test("keeps the upload pipeline's messages", async () => {
    next = async () => ({ bytes: Buffer.alloc(1), name: "a.jpg" });
    const cases: [typeof stored, RegExp][] = [
      [{ ok: false, reason: "duplicate" }, /zaten var/], [{ ok: false, reason: "limit" }, /en çok 12 görsel/], [{ ok: false, reason: "merged" }, /birleştirildi/],
      [{ ok: false, reason: "stale" }, /başka bir sekmede/], [{ ok: false, reason: "not-found" }, /bulunamadı/],
      [{ ok: false, reason: "image", image: "dimensions" }, /en az 200 piksel/], [{ ok: false, reason: "image", image: "unreadable" }, /bozuk/],
      [{ ok: false, reason: "image", image: "type" }, /JPEG, PNG veya WebP/],
    ];
    for (const [result, message] of cases) {
      stored = result;
      assert.match((await actions.addProductImageFromUrl({ productId, url: "https://example.com/a.jpg" })).message, message);
    }
  });
});
