export type SupplierMode = "mock" | "live" | "hybrid";

export function getSupplierMode(): SupplierMode {
  const mode = process.env.SUPPLIER_MODE ?? "mock";
  if (mode === "live" || mode === "hybrid") return mode;
  return "mock";
}

export function isSupplierAEnabled(): boolean {
  return process.env.SUPPLIER_A_ENABLED === "true";
}

export function getSupplierATimeoutMs(): number {
  const val = parseInt(process.env.SUPPLIER_A_TIMEOUT_MS ?? "8000", 10);
  return Number.isFinite(val) ? val : 8000;
}

export function isSupplierAProxyEnabled(): boolean {
  return process.env.SUPPLIER_A_USE_PROXY === "true";
}

export function getSupplierAProxyUrl(): string {
  return process.env.SUPPLIER_A_PROXY_URL ?? "";
}