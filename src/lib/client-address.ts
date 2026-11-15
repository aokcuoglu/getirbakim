import { isIP } from "node:net";

export type ClientEvidence = { ip: string | null; forwardedFor: string | null; userAgent: string | null };

const limit = 500;
const valid = (value: string | null | undefined) => {
  const ip = value?.trim();
  return ip && isIP(ip) ? ip : null;
};
// CloudFront appends the port ("198.51.100.10:46532", IPv6 "2001:db8::1:46532"); brackets are accepted too.
// A value that already is an address (bare IPv6 without a port) is kept whole.
function withoutPort(value: string) {
  if (isIP(value)) return value;
  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const cut = value.lastIndexOf(":");
  return cut > 0 ? value.slice(0, cut) : value;
}

/**
 * Who sent the request, as far as the edge reports it (consent evidence). The CDN's viewer address wins, then the
 * last hop of X-Forwarded-For (earlier hops are client-supplied). X-Real-IP is not trusted: nothing in front of the
 * app sets it, so a client could. Unparseable values are dropped; the end of the raw forwarded chain is kept.
 */
export function clientEvidence(h: Headers): ClientEvidence {
  const viewer = h.get("cloudfront-viewer-address")?.trim();
  const forwarded = h.get("x-forwarded-for")?.trim() || null;
  const ip = (viewer ? valid(withoutPort(viewer)) : null) ?? valid(forwarded?.split(",").at(-1));
  return {
    ip,
    forwardedFor: forwarded ? forwarded.slice(-limit) : null,
    userAgent: h.get("user-agent")?.trim().slice(0, limit) || null,
  };
}
