"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface ProductSnapshot {
  supplier_product_id: number | null;
  supplier_name: string | null;
  supplier_sku: string | null;
  product_name: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  stock_quantity: number | null;
  data_source: string | null;
  oem_numbers: string[];
}

interface RequestItem {
  id: string;
  product_id: string | null;
  supplier_product_id: number | null;
  product_snapshot: ProductSnapshot | null;
  request_type: string;
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
  "new",
  "reviewing",
  "contacted",
  "quoted",
  "converted",
  "cancelled",
] as const;

const STATUS_LABELS: Record<string, string> = {
  new: "Yeni",
  reviewing: "İnceleniyor",
  contacted: "İletişime Geçildi",
  quoted: "Teklif Verildi",
  converted: "Siparişe Dönüştü",
  cancelled: "İptal Edildi",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-yellow-100 text-yellow-800 border-yellow-300",
  reviewing: "bg-blue-100 text-blue-800 border-blue-300",
  contacted: "bg-indigo-100 text-indigo-800 border-indigo-300",
  quoted: "bg-purple-100 text-purple-800 border-purple-300",
  converted: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-gray-100 text-gray-600 border-gray-300",
};

const TYPE_LABELS: Record<string, string> = {
  quote: "Teklif",
  compatibility: "Uyumluluk",
};

const TYPE_COLORS: Record<string, string> = {
  quote: "bg-blue-50 text-blue-700 border-blue-200",
  compatibility: "bg-orange-50 text-orange-700 border-orange-200",
};

export default function AdminRequestsContent() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const fetchRequests = useCallback(() => {
    fetch("/api/requests")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setRequests(list);
      })
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

  const filteredRequests = requests.filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterType !== "all" && r.request_type !== filterType) return false;
    return true;
  });

  const statusCounts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">Talepler</h1>
          <p className="text-sm text-gray-500 mt-1">{requests.length} talep toplam</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={fetchRequests}
            className="text-sm text-gray-500 hover:text-black transition-colors"
          >
            Yenile
          </button>
          <Link
            href="/admin/suppliers/health"
            className="text-sm text-gray-500 hover:text-black transition-colors"
          >
            Tedarikçi Durumu &rarr;
          </Link>
        </div>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
        {VALID_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
            className={`text-center p-2 rounded-lg border text-xs font-medium transition-colors ${
              filterStatus === s
                ? STATUS_COLORS[s]
                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            <div className="font-semibold">{statusCounts[s] ?? 0}</div>
            <div className="mt-0.5">{STATUS_LABELS[s]}</div>
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:border-black focus:outline-none"
        >
          <option value="all">Tüm tipler</option>
          <option value="quote">Teklif</option>
          <option value="compatibility">Uyumluluk</option>
        </select>
        {filterStatus !== "all" && (
          <button
            onClick={() => setFilterStatus("all")}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            Filtreyi temizle
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-24 bg-gray-100 rounded" />
          ))}
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Henüz talep bulunmamaktadır.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const snapshot = req.product_snapshot as ProductSnapshot | null;
            const isExpanded = expandedId === req.id;

            return (
              <div
                key={req.id}
                className="border border-gray-200 rounded-lg bg-white hover:border-gray-300 transition-colors"
              >
                <div
                  className="p-4 sm:p-5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium border ${
                            TYPE_COLORS[req.request_type] ?? "bg-gray-50 text-gray-600 border-gray-200"
                          }`}
                        >
                          {TYPE_LABELS[req.request_type] ?? req.request_type}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium border ${
                            STATUS_COLORS[req.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                          }`}
                        >
                          {STATUS_LABELS[req.status] ?? req.status}
                        </span>
                      </div>
                      <p className="font-semibold text-black">
                        {req.customer_name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {req.customer_phone}
                        {req.customer_email && ` · ${req.customer_email}`}
                      </p>
                      {snapshot?.product_name && (
                        <p className="text-sm text-gray-700 mt-1">
                          Ürün: <span className="font-medium">{snapshot.product_name}</span>
                          {snapshot.brand && ` — ${snapshot.brand}`}
                          {snapshot.supplier_sku && (
                            <code className="text-xs bg-gray-100 px-1 ml-1">{snapshot.supplier_sku}</code>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-400">
                        {new Date(req.created_at).toLocaleString("tr-TR")}
                      </p>
                      {snapshot?.price != null && snapshot.price > 0 && (
                        <p className="font-bold text-sm text-black mt-1">
                          {formatPrice(snapshot.price, snapshot.currency ?? "TRY")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 p-4 sm:p-5 bg-gray-50 space-y-4">
                    {/* Product Snapshot */}
                    {snapshot && (
                      <div className="border border-blue-200 rounded-md p-4 bg-white">
                        <h4 className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">Ürün Bilgisi</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                          {snapshot.product_name && (
                            <div><span className="text-gray-500">Ürün:</span> <span className="font-medium text-black">{snapshot.product_name}</span></div>
                          )}
                          {snapshot.brand && (
                            <div><span className="text-gray-500">Marka:</span> <span className="font-medium">{snapshot.brand}</span></div>
                          )}
                          {snapshot.supplier_name && (
                            <div><span className="text-gray-500">Tedarikçi:</span> <span className="font-medium">{snapshot.supplier_name}</span></div>
                          )}
                          {snapshot.supplier_sku && (
                            <div><span className="text-gray-500">SKU:</span> <code className="text-xs bg-gray-100 px-1">{snapshot.supplier_sku}</code></div>
                          )}
                          {snapshot.price != null && snapshot.price > 0 && (
                            <div><span className="text-gray-500">Fiyat:</span> <span className="font-bold">{formatPrice(snapshot.price, snapshot.currency ?? "TRY")}</span></div>
                          )}
                          {snapshot.stock_quantity != null && (
                            <div>
                              <span className="text-gray-500">Stok:</span>{" "}
                              <span className={`font-medium ${snapshot.stock_quantity > 0 ? "text-green-700" : "text-red-600"}`}>
                                {snapshot.stock_quantity > 0 ? `Stokta (${snapshot.stock_quantity})` : "Stokta yok"}
                              </span>
                            </div>
                          )}
                          {snapshot.data_source && (
                            <div><span className="text-gray-500">Veri:</span> <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{snapshot.data_source === "existing-db" ? "Katalog" : snapshot.data_source}</span></div>
                          )}
                        </div>
                        {snapshot.oem_numbers && snapshot.oem_numbers.length > 0 && (
                          <div className="mt-2">
                            <span className="text-gray-500 text-sm">OEM:</span>{" "}
                            {snapshot.oem_numbers.slice(0, 5).map((oem) => (
                              <code key={oem} className="text-xs bg-gray-100 px-1 py-0.5 rounded mr-1">{oem}</code>
                            ))}
                            {snapshot.oem_numbers.length > 5 && <span className="text-xs text-gray-400">+{snapshot.oem_numbers.length - 5}</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Customer Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-500">Telefon:</span> <span className="font-medium">{req.customer_phone ?? "-"}</span></div>
                      <div><span className="text-gray-500">E-posta:</span> <span className="font-medium">{req.customer_email || "-"}</span></div>
                      <div><span className="text-gray-500">Araç:</span> <span className="font-medium">{req.vehicle_info || "-"}</span></div>
                      {req.supplier_product_id && (
                        <div><span className="text-gray-500">Ürün ID:</span> <code className="text-xs bg-gray-100 px-1">db-{req.supplier_product_id}</code></div>
                      )}
                    </div>

                    {req.notes && (
                      <div className="text-sm">
                        <span className="text-gray-500">Notlar:</span>{" "}
                        <span>{req.notes}</span>
                      </div>
                    )}

                    {/* Status Update */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                      <div className="flex items-center gap-2">
                        {/* Quick status actions */}
                        {req.status === "new" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "reviewing"); }}
                            disabled={updatingId === req.id}
                            className="text-xs bg-blue-100 text-blue-800 px-3 py-1.5 rounded font-medium hover:bg-blue-200 transition-colors disabled:opacity-50"
                          >
                            İncelemeye Al
                          </button>
                        )}
                        {req.status === "reviewing" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "contacted"); }}
                            disabled={updatingId === req.id}
                            className="text-xs bg-indigo-100 text-indigo-800 px-3 py-1.5 rounded font-medium hover:bg-indigo-200 transition-colors disabled:opacity-50"
                          >
                            İletişime Geçildi
                          </button>
                        )}
                        {req.status === "contacted" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "quoted"); }}
                            disabled={updatingId === req.id}
                            className="text-xs bg-purple-100 text-purple-800 px-3 py-1.5 rounded font-medium hover:bg-purple-200 transition-colors disabled:opacity-50"
                          >
                            Teklif Verildi
                          </button>
                        )}
                        {req.status === "quoted" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "converted"); }}
                            disabled={updatingId === req.id}
                            className="text-xs bg-green-100 text-green-800 px-3 py-1.5 rounded font-medium hover:bg-green-200 transition-colors disabled:opacity-50"
                          >
                            Siparişe Dönüştü
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {req.status !== "cancelled" && req.status !== "converted" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "cancelled"); }}
                            disabled={updatingId === req.id}
                            className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                          >
                            İptal
                          </button>
                        )}
                        <select
                          value={req.status}
                          onChange={(e) => { e.stopPropagation(); updateStatus(req.id, e.target.value); }}
                          disabled={updatingId === req.id}
                          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:border-black focus:outline-none disabled:opacity-50"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {VALID_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* KVKK info */}
                    <div className="text-xs text-gray-400 flex items-center gap-2 pt-2">
                      <span>KVKK: {req.kvkk_consent ? "✓ Onaylı" : "✗ Onay yok"}</span>
                      {req.kvkk_consent_at && <span>· {new Date(req.kvkk_consent_at).toLocaleString("tr-TR")}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}