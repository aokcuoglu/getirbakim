"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Database, RefreshCw, AlertCircle, CheckCircle, Search } from "lucide-react";

interface DbStats {
  connected: boolean;
  error?: string;
  tableExists?: boolean;
  rowCount?: number;
  supplierColumn?: string;
  supplierCounts?: Record<string, number>;
  columns?: { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[];
}

interface SearchResult {
  products: { id: string; name: string; brand: string | null; supplierName: string; supplierSku: string; price: number; stockQuantity: number }[];
  total: number;
  query: string;
  dataSource?: string;
  supplierCounts?: Record<string, number>;
  errors: string[];
}

export default function ExistingDbContent() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/catalog-db")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) { setStats(data); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) { setStats({ connected: false, error: err.message }); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
      if (res.ok) {
        setSearchResults(await res.json());
      }
    } catch {
      // ignore
    }
    setSearchLoading(false);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-black flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Admin
        </Link>
        <h1 className="text-2xl font-bold text-black mt-2 flex items-center gap-2">
          <Database className="h-6 w-6" />
          Katalog Veritabanı
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Mevcut Supabase katalog veritabanı durumu ve arama testi
        </p>
      </div>

      {/* Connection Status */}
      <div className="mb-6 border rounded-md p-4">
        <h2 className="font-semibold text-sm text-gray-700 mb-3">Bağlantı Durumu</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Yükleniyor...
          </div>
        ) : stats ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {stats.connected ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600" />
              )}
              <span className={stats.connected ? "text-green-700" : "text-red-700"}>
                {stats.connected ? "Bağlı" : "Bağlantı Hatası"}
              </span>
            </div>
            {stats.error && (
              <p className="text-red-600 text-xs">{stats.error}</p>
            )}
            {stats.tableExists !== undefined && (
              <div className="flex items-center gap-2">
                {stats.tableExists ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                )}
                <span>
                  {stats.tableExists
                    ? "supplier_products tablosu mevcut"
                    : "supplier_products tablosu bulunamadı"}
                </span>
              </div>
            )}
            {stats.rowCount !== undefined && (
              <p>Toplam kayıt: <strong>{stats.rowCount.toLocaleString("tr-TR")}</strong></p>
            )}
            {stats.supplierColumn && (
              <p>Tedarikçi kolonu: <code className="bg-gray-100 px-1 rounded">{stats.supplierColumn}</code></p>
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Veri alınamadı</p>
        )}
        <button
          onClick={() => {
            setLoading(true);
            fetch("/api/admin/catalog-db")
              .then((res) => res.json())
              .then((data) => { setStats(data); setLoading(false); })
              .catch((err) => { setStats({ connected: false, error: err.message }); setLoading(false); });
          }}
          className="mt-3 text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200 flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          Yenile
        </button>
      </div>

      {/* Supplier Counts */}
      {stats?.supplierCounts && Object.keys(stats.supplierCounts).length > 0 && (
        <div className="mb-6 border rounded-md p-4">
          <h2 className="font-semibold text-sm text-gray-700 mb-3">Tedarikçi Dağılımı</h2>
          <div className="space-y-1">
            {Object.entries(stats.supplierCounts).map(([supplier, count]) => (
              <div key={supplier} className="flex justify-between text-sm">
                <span>{supplier}</span>
                <span className="font-medium">{count.toLocaleString("tr-TR")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Columns */}
      {stats?.columns && stats.columns.length > 0 && (
        <div className="mb-6 border rounded-md p-4">
          <h2 className="font-semibold text-sm text-gray-700 mb-3">Tablo Kolonları</h2>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-3 font-medium">Kolon</th>
                  <th className="py-1 pr-3 font-medium">Tip</th>
                  <th className="py-1 pr-3 font-medium">Null</th>
                  <th className="py-1 font-medium">Default</th>
                </tr>
              </thead>
              <tbody>
                {stats.columns.map((col) => (
                  <tr key={col.column_name} className="border-b border-gray-50">
                    <td className="py-1 pr-3 font-mono">{col.column_name}</td>
                    <td className="py-1 pr-3">{col.data_type}</td>
                    <td className="py-1 pr-3">{col.is_nullable}</td>
                    <td className="py-1 text-gray-500">{col.column_default || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Search Test */}
      <div className="mb-6 border rounded-md p-4">
        <h2 className="font-semibold text-sm text-gray-700 mb-3">Arama Testi</h2>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Bosch, filtre, balata..."
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-black"
          />
          <button
            type="submit"
            disabled={searchLoading}
            className="bg-black text-white px-4 py-2 rounded text-sm flex items-center gap-1 hover:bg-gray-800 disabled:bg-gray-400"
          >
            <Search className="h-3.5 w-3.5" />
            Ara
          </button>
        </form>

        {searchResults && (
          <div className="mt-4">
            <p className="text-sm text-gray-600 mb-2">
              &ldquo;{searchResults.query}&rdquo; için {searchResults.total} sonuç
              {searchResults.dataSource && (
                <span className="ml-1 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                  {searchResults.dataSource}
                </span>
              )}
            </p>
            {searchResults.supplierCounts && (
              <div className="flex flex-wrap gap-2 mb-2">
                {Object.entries(searchResults.supplierCounts).map(([s, c]) => (
                  <span key={s} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                    {s}: {c}
                  </span>
                ))}
              </div>
            )}
            {searchResults.products.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {searchResults.products.slice(0, 20).map((p) => (
                  <div key={p.id} className="text-xs border border-gray-100 p-2 rounded">
                    <span className="font-medium">{p.name}</span>
                    {p.brand && <span className="text-gray-500 ml-1">— {p.brand}</span>}
                    <span className="text-gray-400 ml-1">({p.supplierName})</span>
                  </div>
                ))}
              </div>
            )}
            {searchResults.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-600">
                {searchResults.errors.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}