import { isIP } from "node:net";
import { remoteImageUrlMaxLength } from "./product-image-limits";

/**
 * Admin "add image from URL" (#725): which addresses an image may be fetched from. Kept free of I/O so the rules are
 * tested on their own; the fetch lives in remote-image.ts.
 */
export { remoteImageUrlMaxLength };

export type RemoteImageErrorReason = "url" | "blocked" | "unreachable" | "timeout" | "status" | "not-image" | "size" | "redirects";
export class RemoteImageError extends Error {
  constructor(readonly reason: RemoteImageErrorReason) {
    super(`Remote image rejected: ${reason}`);
    this.name = "RemoteImageError";
  }
}

/** An http(s) URL with a host and no credentials, at most remoteImageUrlMaxLength characters; null otherwise. */
export function parseRemoteImageUrl(raw: string): URL | null {
  if (!raw || raw.length > remoteImageUrlMaxLength) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url;
}

/** The URL's host as a DNS name or a bare IP address (IPv6 without brackets). */
export function urlHost(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

function ipv4Bytes(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every(byte => byte <= 255) ? bytes : null;
}

function ipv6Bytes(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/, "");
  let tail: number[] = [];
  const dotted = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v4 = ipv4Bytes(dotted[1]);
    if (!v4) return null;
    tail = v4;
    text = `${text.slice(0, dotted.index)}:0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part ? part.split(":") : []);
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (all.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes = all.flatMap(group => { const value = parseInt(group, 16); return [value >> 8, value & 0xff]; });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const inPrefix = (bytes: number[], prefix: number[], bits: number) => {
  for (let bit = 0; bit < bits; bit++) {
    const mask = 0x80 >> (bit % 8);
    if ((bytes[bit >> 3] & mask) !== (prefix[bit >> 3] & mask)) return false;
  }
  return true;
};

// Not reachable on the public internet: this host, private networks, CGNAT, link-local (cloud metadata 169.254.169.254),
// IETF/test/benchmark ranges, multicast, reserved and broadcast.
const blockedIpv4: [number[], number][] = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12], [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24], [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24], [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];
// Inside global unicast 2000::/3: IETF protocol assignments (Teredo included), documentation and 6to4.
const blockedIpv6: [number[], number][] = [
  [[0x20, 0x01, 0x00, 0x00], 23], [[0x20, 0x01, 0x0d, 0xb8], 32], [[0x20, 0x02], 16], [[0x3f, 0xff, 0x00], 20],
];

function publicIpv4(bytes: number[]) {
  return !blockedIpv4.some(([prefix, bits]) => inPrefix(bytes, prefix, bits));
}

/**
 * True only for a public unicast address. IPv6 must be global unicast (2000::/3) outside the blocked ranges; an
 * IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d) address is judged by its IPv4 part. Anything that does not
 * parse is not public.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address.replace(/%.*$/, ""));
  if (family === 4) {
    const bytes = ipv4Bytes(address);
    return bytes !== null && publicIpv4(bytes);
  }
  if (family !== 6) return false;
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const embedded = bytes.slice(12);
  if (inPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return publicIpv4(embedded);
  if (inPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) return publicIpv4(embedded);
  if (!inPrefix(bytes, [0x20], 3)) return false;
  return !blockedIpv6.some(([prefix, bits]) => inPrefix(bytes, prefix, bits));
}

/** A display name for the stored image from the URL's last path segment ("gorsel" when there is none). */
export function remoteImageName(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  let name: string;
  try { name = decodeURIComponent(segment); } catch { name = segment; }
  return name.trim() || "gorsel";
}
