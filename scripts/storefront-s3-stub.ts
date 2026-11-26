import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

// An S3 stub for the storefront bundle tests (test-storefront-e2e.ts) and measurements (measure-storefront-import-media.ts):
// path-style GET/HEAD/PUT of whole objects with their x-amz-meta-* metadata and ListObjectsV2 (prefix, delimiter,
// continuation-token) on 127.0.0.1, nothing else. Anything it does not understand answers 501 and is recorded in `unsupported`.
// `puts`, `gets` and `heads` record the object paths (bucket/key) of the requests it served; a path in `failPuts` answers
// a PUT with 403 AccessDenied and is not written. A PUT may carry x-amz-checksum-sha256 (#1417): it is checked against the
// bytes received, a mismatch answers 400 BadDigest and writes nothing, a match is echoed as S3 does and its path recorded
// in `checksummedPuts`. Any other x-amz-checksum-* header is not supported. A path in `corruptPuts` has its first body byte
// flipped on arrival (a transfer that went wrong). `latencyMs` delays every response (a round trip to a remote store).

export type StubObject = { bytes: Buffer; contentType: string; metadata?: Record<string, string> };
export type S3Stub = Awaited<ReturnType<typeof startS3Stub>>;
// A small page size makes the importer's continuation loop run.
const LIST_PAGE = 3;
const META = "x-amz-meta-";
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const etag = (bytes: Buffer) => `"${createHash("md5").update(bytes).digest("hex")}"`;
const metadataHeaders = (object: StubObject) => Object.fromEntries(Object.entries(object.metadata ?? {}).map(([name, value]) => [`${META}${name}`, value]));

export async function startS3Stub(options: { latencyMs?: number } = {}) {
  const { latencyMs = 0 } = options;
  const objects = new Map<string, StubObject>();
  const state = { puts: [] as string[], gets: [] as string[], heads: [] as string[], unsupported: [] as string[], failPuts: new Set<string>(),
    checksummedPuts: [] as string[], corruptPuts: new Set<string>() };
  const handle = (req: IncomingMessage, res: ServerResponse, chunks: Buffer[]) => {
    const path = (req.url ?? "").split("?")[0].split("/").filter(Boolean).map(segment => decodeURIComponent(segment)).join("/");
    const fail = (status: number, code: string) => { res.writeHead(status, { "Content-Type": "application/xml" }); res.end(`<Error><Code>${code}</Code></Error>`); };
    if (req.headers["content-encoding"]?.includes("aws-chunked") || String(req.headers["x-amz-content-sha256"] ?? "").startsWith("STREAMING-")) {
      state.unsupported.push(`${req.method} ${path} (aws-chunked)`);
      return fail(501, "NotImplemented");
    }
    if (req.method === "GET" && !path.includes("/")) {
      const query = new URL(req.url ?? "", "http://stub").searchParams;
      if (query.get("list-type") !== "2" || [...query.keys()].some(name => !["list-type", "prefix", "delimiter", "continuation-token"].includes(name))) {
        state.unsupported.push(`GET ${path}?${query.toString()}`);
        return fail(501, "NotImplemented");
      }
      const prefix = query.get("prefix") ?? "", delimiter = query.get("delimiter");
      const entries = new Map<string, { key: string; size: number } | { prefix: string }>();
      for (const [full, object] of objects) {
        if (!full.startsWith(`${path}/${prefix}`)) continue;
        const key = full.slice(path.length + 1), rest = key.slice(prefix.length);
        const cut = delimiter ? rest.indexOf(delimiter) : -1;
        if (cut >= 0) entries.set(`${prefix}${rest.slice(0, cut + delimiter!.length)}`, { prefix: `${prefix}${rest.slice(0, cut + delimiter!.length)}` });
        else entries.set(key, { key, size: object.bytes.length });
      }
      const after = query.get("continuation-token");
      const sorted = [...entries.keys()].sort().filter(name => after === null || name > after);
      const page = sorted.slice(0, LIST_PAGE), truncated = sorted.length > page.length;
      const body = page.map(name => {
        const entry = entries.get(name)!;
        return "key" in entry ? `<Contents><Key>${xmlEscape(entry.key)}</Key><Size>${entry.size}</Size></Contents>` : `<CommonPrefixes><Prefix>${xmlEscape(entry.prefix)}</Prefix></CommonPrefixes>`;
      }).join("");
      res.writeHead(200, { "Content-Type": "application/xml" });
      return void res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${path}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${LIST_PAGE}</MaxKeys>`
        + `<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${xmlEscape(page[page.length - 1])}</NextContinuationToken>` : ""}${body}</ListBucketResult>`);
    }
    if (req.method === "GET") {
      state.gets.push(path);
      const object = objects.get(path);
      if (!object) return fail(404, "NoSuchKey");
      res.writeHead(200, { "Content-Length": object.bytes.length, "Content-Type": object.contentType, ETag: etag(object.bytes), ...metadataHeaders(object) });
      return void res.end(object.bytes);
    }
    // HeadObject: the headers GET would send, no body (a 404 has none either).
    if (req.method === "HEAD" && path.includes("/")) {
      state.heads.push(path);
      const object = objects.get(path);
      if (!object) { res.writeHead(404); return void res.end(); }
      res.writeHead(200, { "Content-Length": object.bytes.length, "Content-Type": object.contentType, ETag: etag(object.bytes), ...metadataHeaders(object) });
      return void res.end();
    }
    if (req.method === "PUT") {
      const checksums = Object.keys(req.headers).filter(name => name.startsWith("x-amz-checksum-"));
      if (checksums.some(name => name !== "x-amz-checksum-sha256")) {
        state.unsupported.push(`PUT ${path} (${checksums.join(",")})`);
        return fail(501, "NotImplemented");
      }
      if (state.failPuts.has(path)) return fail(403, "AccessDenied");
      const bytes = Buffer.concat(chunks);
      if (state.corruptPuts.has(path) && bytes.length) bytes[0] ^= 0xff;
      const checksum = req.headers["x-amz-checksum-sha256"];
      if (checksum !== undefined && checksum !== createHash("sha256").update(bytes).digest("base64")) return fail(400, "BadDigest");
      const metadata = Object.fromEntries(Object.entries(req.headers).filter(([name]) => name.startsWith(META)).map(([name, value]) => [name.slice(META.length), String(value)]));
      objects.set(path, { bytes, contentType: String(req.headers["content-type"] ?? "application/octet-stream"), ...(Object.keys(metadata).length ? { metadata } : {}) });
      state.puts.push(path);
      if (checksum !== undefined) state.checksummedPuts.push(path);
      res.writeHead(200, { ETag: etag(bytes), "Content-Length": 0, ...(checksum !== undefined ? { "x-amz-checksum-sha256": checksum } : {}) });
      return void res.end();
    }
    state.unsupported.push(`${req.method} ${path}`);
    fail(501, "NotImplemented");
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
      if (latencyMs > 0) setTimeout(() => handle(req, res, chunks), latencyMs);
      else handle(req, res, chunks);
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("S3 stub has no port");
  return {
    url: `http://127.0.0.1:${address.port}`, objects, ...state,
    close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

/** The environment a child process needs to reach the stub at `url` (and nothing else: callers scrub AWS_* and S3_* first). */
export function stubEnv(url: string) {
  return {
    S3_ENDPOINT: url, S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test-secret",
    // Plain PUT bodies: the stub does not decode aws-chunked uploads with trailing checksums, nor checks a checksum other than
    // the x-amz-checksum-sha256 header the media writers send themselves (#1417), which the SDK leaves alone either way.
    AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED", AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
  };
}
