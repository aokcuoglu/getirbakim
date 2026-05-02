import { NextResponse } from "next/server";
import { getMemoryLogs, getMemoryLogsCount } from "@/suppliers/logger";
import { getCacheStats } from "@/suppliers/cache";
import { getRateLimitStats } from "@/lib/rate-limit";
import { getSupplierMode } from "@/suppliers/config";

export async function GET() {
  const logs = getMemoryLogs(200);
  const cacheStats = getCacheStats();
  const rateLimitStats = getRateLimitStats();
  const logCount = getMemoryLogsCount();
  const mode = getSupplierMode();

  return NextResponse.json({
    mode,
    logs,
    logCount,
    cache: cacheStats,
    rateLimit: rateLimitStats,
  });
}