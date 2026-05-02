"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupplierHealthStatus } from "@/types";

export default function SupplierHealthContent() {
  const [suppliers, setSuppliers] = useState<SupplierHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier-health")
      .then((res) => res.json())
      .then((data) => setSuppliers(data))
      .catch(() => setSuppliers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-black">Tedarikçi Durumu</h1>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/requests"
              className="text-sm text-gray-500 hover:text-black transition-colors"
            >
              &larr; Talepler
            </Link>
            <Link
              href="/admin/suppliers/logs"
              className="text-sm text-gray-500 hover:text-black transition-colors"
            >
              API Logları &rarr;
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
        <div className="space-y-3">
          {suppliers.map((s) => (
            <div
              key={s.supplierId}
              className="border border-gray-200 rounded p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-semibold text-black">{s.supplierName}</p>
                <p className="text-xs text-gray-400">{s.supplierId}</p>
              </div>
              <div className="flex items-center gap-4">
                {s.responseTimeMs !== null && (
                  <span className="text-sm text-gray-500">
                    {s.responseTimeMs}ms
                  </span>
                )}
                <span
                  className={`inline-flex items-center text-sm font-medium px-3 py-1 rounded ${
                    s.isHealthy
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {s.isHealthy ? "Aktif" : "Hata"}
                </span>
              </div>
            </div>
          ))}
          {suppliers.length === 0 && (
            <p className="text-gray-500 text-center py-8">
              Tedarikçi bulunamadı.
            </p>
          )}
        </div>
      )}

      {suppliers.some((s) => s.lastError) && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-black mb-2">Hata Detayları</h2>
          <div className="space-y-2">
            {suppliers
              .filter((s) => s.lastError)
              .map((s) => (
                <div
                  key={s.supplierId}
                  className="text-sm p-3 bg-red-50 border border-red-200 rounded"
                >
                  <span className="font-medium">{s.supplierName}:</span>{" "}
                  <span className="text-red-700">{s.lastError}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}