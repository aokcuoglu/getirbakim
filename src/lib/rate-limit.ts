/**
 * v0.2.0 Simple in-memory rate limiter for /api/search.
 * Limits requests per IP per time window.
 * Respects x-forwarded-for header when available.
 * Returns 429 with a friendly message when exceeded.
 */

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 30;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const limits = new Map<string, RateLimitEntry>();

function getWindowMs(): number {
  const envVal = parseInt(process.env.SEARCH_RATE_LIMIT_WINDOW_SECONDS ?? "", 10);
  const seconds = Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_WINDOW_SECONDS;
  return seconds * 1000;
}

function getMaxRequests(): number {
  const envVal = parseInt(process.env.SEARCH_RATE_LIMIT_MAX ?? "", 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_MAX_REQUESTS;
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((s) => s.trim());
    if (ips.length > 0 && ips[0]) return ips[0];
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(ip: string): RateLimitResult {
  const windowMs = getWindowMs();
  const maxRequests = getMaxRequests();
  const now = Date.now();
  const entry = limits.get(ip);

  if (!entry || now - entry.windowStart > windowMs) {
    limits.set(ip, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: now + windowMs,
    };
  }

  entry.count += 1;

  if (entry.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + windowMs,
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.windowStart + windowMs,
  };
}

export function getRateLimitStats(): { entries: number; windowMs: number; maxRequests: number } {
  return { entries: limits.size, windowMs: getWindowMs(), maxRequests: getMaxRequests() };
}