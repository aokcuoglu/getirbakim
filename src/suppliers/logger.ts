export interface SupplierLogEntry {
  supplierId: string;
  supplierName: string;
  operation: string;
  success: boolean;
  durationMs: number;
  statusCode?: number;
  error?: string;
}

interface MemoryLogEntry extends SupplierLogEntry {
  createdAt: string;
}

const MEMORY_LOG_MAX = 500;
const memoryLogs: MemoryLogEntry[] = [];

export function logSupplierCall(entry: SupplierLogEntry): Promise<void> {
  const logWithTimestamp = {
    ...entry,
    createdAt: new Date().toISOString(),
  };

  memoryLogs.push(logWithTimestamp);
  if (memoryLogs.length > MEMORY_LOG_MAX) {
    memoryLogs.shift();
  }

  logSupplierCallToSupabase(entry).catch(() => {});

  return Promise.resolve();
}

export function getMemoryLogs(limit: number = 100): MemoryLogEntry[] {
  return memoryLogs.slice(-limit).reverse();
}

export function getMemoryLogsCount(): number {
  return memoryLogs.length;
}

async function logSupplierCallToSupabase(entry: SupplierLogEntry): Promise<void> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    await supabase.from("supplier_api_logs").insert({
      supplier_id: entry.supplierId,
      endpoint: entry.operation,
      method: entry.operation === "search" ? "GET" : "GET",
      status_code: entry.statusCode ?? null,
      response_time_ms: entry.durationMs,
      error_message: entry.error ?? null,
    } as never);
  } catch {}
}