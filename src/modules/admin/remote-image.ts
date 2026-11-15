import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { productImageLimits, productImageTypes } from "./product-image-limits";
import { isPublicAddress, parseRemoteImageUrl, RemoteImageError, remoteImageName, urlHost } from "./remote-image-url";

type Resolved = { address: string; family: number };
export type RemoteImageOptions = {
  /** Which resolved addresses may be connected to; tests allow their loopback fixture here. */
  allowAddress?: (address: string) => boolean;
  resolve?: (host: string) => Promise<Resolved[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const userAgent = "Mozilla/5.0 (compatible; ImageFetcher/1.0)";
const redirects = new Set([301, 302, 303, 307, 308]);

const resolveAll = (host: string) => dnsLookup(host, { all: true, verbatim: true });

/** Rejects when the signal aborts, so a hanging DNS lookup still ends at the deadline. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RemoteImageError("timeout"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** The address to connect to: every address the host resolves to must be allowed (no mixed public/private answers). */
async function vet(url: URL, allow: (address: string) => boolean, resolve: (host: string) => Promise<Resolved[]>, signal: AbortSignal): Promise<Resolved> {
  const host = urlHost(url);
  const literal = isIP(host);
  const addresses = literal ? [{ address: host, family: literal }]
    : await untilAborted(resolve(host), signal).catch(error => {
      if (error instanceof RemoteImageError) throw error;
      throw new RemoteImageError("unreachable");
    });
  if (!addresses.length) throw new RemoteImageError("unreachable");
  if (addresses.some(({ address }) => !allow(address))) throw new RemoteImageError("blocked");
  return addresses[0];
}

/** One GET pinned to the vetted address: the socket's lookup answers with it, so DNS cannot change between check and connect. */
function get(url: URL, target: Resolved, signal: AbortSignal): Promise<IncomingMessage> {
  const lookup: LookupFunction = (_host, options, callback) => {
    if (options.all) callback(null, [target]);
    else callback(null, target.address, target.family);
  };
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET", agent: false, lookup, signal,
      headers: { "user-agent": userAgent, accept: productImageTypes.join(","), "accept-encoding": "identity" },
    }, resolve);
    req.once("error", () => reject(signal.aborted ? new RemoteImageError("timeout") : new RemoteImageError("unreachable")));
    req.end();
  });
}

async function readCapped(response: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of response) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw new RemoteImageError("size");
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    response.destroy();
    if (error instanceof RemoteImageError) throw error;
    throw new RemoteImageError(signal.aborted ? "timeout" : "unreachable");
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads an image an admin pointed to (#725) without letting the server reach internal addresses (SSRF): every hop's
 * host is resolved and all its addresses must be public, the connection is pinned to the vetted address, at most three
 * redirects are followed (each re-checked), the whole fetch has one deadline, and the body is cut off past the upload
 * size limit. Only a JPEG, PNG or WebP Content-Type is read; prepareProductImage still decodes and checks the bytes.
 */
export async function fetchRemoteImage(raw: string, options: RemoteImageOptions = {}): Promise<{ bytes: Buffer; name: string }> {
  const { allowAddress = isPublicAddress, resolve = resolveAll, timeoutMs = 10_000, maxBytes = productImageLimits.maxBytes, maxRedirects = 3 } = options;
  let url = parseRemoteImageUrl(raw);
  if (!url) throw new RemoteImageError("url");
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    const target = await vet(url, allowAddress, resolve, signal);
    const response = await get(url, target, signal);
    const status = response.statusCode ?? 0;
    if (redirects.has(status)) {
      response.destroy();
      const location = response.headers.location;
      if (hop >= maxRedirects) throw new RemoteImageError("redirects");
      let next: URL | null = null;
      try { next = location ? parseRemoteImageUrl(new URL(location, url).href) : null; } catch { next = null; }
      if (!next) throw new RemoteImageError("unreachable");
      url = next;
      continue;
    }
    if (status < 200 || status > 299) {
      response.destroy();
      throw new RemoteImageError("status");
    }
    const type = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!productImageTypes.some(allowed => allowed === type)) {
      response.destroy();
      throw new RemoteImageError("not-image");
    }
    if (Number(response.headers["content-length"]) > maxBytes) {
      response.destroy();
      throw new RemoteImageError("size");
    }
    const bytes = await readCapped(response, maxBytes, signal);
    if (!bytes.length) throw new RemoteImageError("not-image");
    return { bytes, name: remoteImageName(url) };
  }
}
