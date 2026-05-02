import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/suppliers/search";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Çok fazla arama isteği. Lütfen biraz bekleyip tekrar deneyin.",
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({
      products: [],
      total: 0,
      query: "",
      errors: [],
      lastCheckedAt: new Date().toISOString(),
    });
  }

  const results = await searchProducts(query);
  return NextResponse.json({
    ...results,
    lastCheckedAt: new Date().toISOString(),
  });
}