"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface LogEntry {
  supplierId: string;
  supplierName: string;
  operation: string;
  success: boolean;
  durationMs: number;
  statusCode?: number;
  error?: string;
  createdAt: string;
}

interface LogsData {
  mode: string;
  logs: LogEntry[];
  logCount: number;
  cache: { size: number; ttlMs: number };
  rateLimit: { entries: number; windowMs: number; maxRequests: number };
}

export default function SupplierLogsContent() {
  const [data, setData] = useState<LogsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    const credentials = sessionStorage.getItem("admin_auth");
    const headers: Record<string, string> = {};
    if (credentials) {
      headers["Authorization"] = `Basic ${credentials}`;
    }

    fetch("/api/admin/supplier-logs", { headers })
      .then((res) => res.json())
      .then((d: LogsData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-black">Tedarikçi API Logları</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="text-sm text-gray-500 hover:text-black transition-colors"
          >
            Yenile
          </button>
          <Link
            href="/admin/suppliers/health"
            className="text-sm text-gray-500 hover:text-black transition-colors"
          >
            Sağlık Durumu &rarr;
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-16 bg-gray-100 rounded" />
          ))}
        </div>
      ) : (
        <>
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="border border-gray-200 rounded p-3">
                <p className="text-xs text-gray-500">Tedarikçi Modu</p>
                <p className="text-sm font-semibold text-black">{data.mode}</p>
              </div>
              <div className="border border-gray-200 rounded p-3">
                <p className="text-xs text-gray-500">Toplam Log</p>
                <p className="text-sm font-semibold text-black">{data.logCount}</p>
              </div>
              <div className="border border-gray-200 rounded p-3">
                <p className="text-xs text-gray-500">Önbellek</p>
                <p className="text-sm font-semibold text-black">{data.cache.size} giriş / {Math.round(data.cache.ttlMs / 1000)}s TTL</p>
              </div>
              <div className="border border-gray-200 rounded p-3">
                <p className="text-xs text-gray-500">Rate Limit</p>
                <p className="text-sm font-semibold text-black">{data.rateLimit.maxRequests}/{Math.round(data.rateLimit.windowMs / 1000)}s</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {data?.logs.map((log, i) => (
              <div
                key={`${log.supplierId}-${log.createdAt}-${i}`}
                className={`border rounded p-3 text-sm flex items-center justify-between ${
                  log.success
                    ? "border-gray-200 bg-white"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      log.success ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-black truncate">
                      {log.supplierName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {log.operation} {log.statusCode ? `• ${log.statusCode}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {log.error && (
                    <span className="text-xs text-red-600 truncate max-w-48">
                      {log.error}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {log.durationMs}ms
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(log.createdAt).toLocaleString("tr-TR")}
                  </span>
                </div>
              </div>
            ))}
            {(!data?.logs || data.logs.length === 0) && (
              <p className="text-gray-500 text-center py-8">
                Henüz API log kaydı bulunmamaktadır.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}