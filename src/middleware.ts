import type { NextRequest } from "next/server";
import { proxy } from "@/lib/admin-auth";

export function middleware(request: NextRequest) {
  return proxy(request);
}

export const config = {
  matcher: ["/admin/:path*", "/api/requests", "/api/admin/:path*"],
};