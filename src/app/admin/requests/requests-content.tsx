"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface RequestItem {
  id: string;
  product_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  vehicle_info: string | null;
  notes: string | null;
  status: string;
  kvkk_consent: boolean;
  kvkk_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES = [
  "pending",
  "contacted",
  "quoted",
  "closed",
  "cancelled",
] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: "Beklemede",
  contacted: "İletişime Geçildi",
  quoted: "Teklif Verildi",
  closed: "Tamamlandı",
  cancelled: "İptal Edildi",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  contacted: "bg-blue-100 text-blue-800",
  quoted: "bg-purple-100 text-purple-800",
  closed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
};

export default function AdminRequestsContent() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchRequests = useCallback(() => {
    fetch("/api/requests")
      .then((res) => res.json())
      .then((data) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id);
    try {
      const credentials = sessionStorage.getItem("admin_auth");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (credentials) {
        headers["Authorization"] = `Basic ${credentials}`;
      }

      const res = await fetch(`/api/requests/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status, updated_at: new Date().toISOString() }
              : r
          )
        );
      }
    } catch {
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-black">Talepler</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{requests.length} talep</span>
          <Link
            href="/admin/suppliers/health"
            className="text-sm text-gray-500 hover:text-black transition-colors"
          >
            Tedarikçi Durumu &rarr;
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-24 bg-gray-100 rounded" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Henüz talep bulunmamaktadır.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div
              key={req.id}
              className="border border-gray-200 rounded-md p-4 sm:p-5 hover:border-gray-400 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-black">
                    {req.customer_name}
                  </p>
                  <p className="text-sm text-gray-500">{req.customer_email}</p>
                  {req.customer_phone && (
                    <p className="text-sm text-gray-400">
                      {req.customer_phone}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded font-medium shrink-0 ${
                    STATUS_COLORS[req.status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {STATUS_LABELS[req.status] ?? req.status}
                </span>
              </div>
              {req.vehicle_info && (
                <p className="text-sm text-gray-600 mt-2">
                  Araç: {req.vehicle_info}
                </p>
              )}
              {req.notes && (
                <p className="text-sm text-gray-500 mt-1">{req.notes}</p>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  {new Date(req.created_at).toLocaleString("tr-TR")}
                </p>
                <select
                  value={req.status}
                  onChange={(e) => updateStatus(req.id, e.target.value)}
                  disabled={updatingId === req.id}
                  className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:border-black focus:outline-none disabled:opacity-50"
                >
                  {VALID_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}