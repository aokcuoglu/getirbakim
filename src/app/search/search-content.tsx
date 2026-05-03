"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import Link from "next/link";
import type { SearchResult } from "@/types";
import { AlertCircle, Clock, Database } from "lucide-react";

export default function SearchPageContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const router = useRouter();
  const [inputValue, setInputValue] = useState(query);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inputValue.trim()) {
      router.push(`/search?q=${encodeURIComponent(inputValue.trim())}`);
    }
  }

  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((res) => {
        if (res.status === 429) {
          return res.json().then((data) => {
            throw new Error(data.error ?? "Çok fazla istek");
          });
        }
        return res.json();
      })
      .then((data: SearchResult) => {
        if (!controller.signal.aborted) {
          setResults(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setResults({
            products: [],
            total: 0,
            query,
            errors: [
              {
                supplierId: "system",
                supplierName: "Sistem",
                error:
                  err instanceof Error
                    ? err.message
                    : "Arama sırasında bir hata oluştu",
              },
            ],
          });
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [query]);

  const isFromDb = results?.dataSource === "existing-db";

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="mb-6">
        <form onSubmit={handleSubmit}>
          <div className="flex items-center border border-gray-300 bg-white rounded-md overflow-hidden focus-within:border-black transition-colors h-12">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Parça adı, OEM numarası veya marka ara..."
              className="flex-1 border-0 bg-transparent px-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
            <button
              type="submit"
              className="flex items-center justify-center bg-black text-white hover:bg-gray-800 transition-colors h-12 w-12"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>
          </div>
        </form>
      </div>

      {query && (
        <div className="mb-5 text-sm text-gray-500">
          {loading ? (
            "Aranıyor..."
          ) : results ? (
            <>&ldquo;{query}&rdquo; için {results.total} sonuç bulundu</>
          ) : null}
        </div>
      )}

      {results?.errors && results.errors.length > 0 && (
        <div className="mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-xs text-yellow-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p>
                Bazı tedarikçilerden yanıt alınamadı, mevcut sonuçlar gösteriliyor.
              </p>
              {results.errors.map((err, i) => (
                <p key={i} className="mt-1 text-yellow-700">
                  {err.supplierName}: {err.error}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {isFromDb && results && results.total > 0 && (
        <div className="mb-5 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          <div className="flex items-start gap-2">
            <Database className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Katalog verisi ile arama</p>
              <p className="mt-0.5">
                Sonuçlar mevcut tedarikçi kataloğundan getirilmektedir. Fiyat ve stok bilgisi talep öncesinde tekrar doğrulanır.
              </p>
              {results.supplierCounts && Object.keys(results.supplierCounts).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Object.entries(results.supplierCounts).map(([supplier, count]) => (
                    <span key={supplier} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      {supplier}: {count} ürün
                    </span>
                  ))}
                </div>
              )}
              {results.liveFallbackUsed && (
                <p className="mt-1 text-blue-600">
                  Canlı tedarikçi API&apos;lerinden de sonuçlar eklendi.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {results?.lastCheckedAt && (
        <div className="mb-4 flex items-center gap-1.5 text-xs text-gray-400">
          <Clock className="h-3.5 w-3.5" />
          <span>
            Son kontrol zamanı: {new Date(results.lastCheckedAt).toLocaleString("tr-TR")}
          </span>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="animate-pulse h-52 bg-gray-100 rounded-md border border-gray-200"
            />
          ))}
        </div>
      )}

      {results && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.products.map((product) => (
              <ProductCard
                key={product.id}
                product={{ ...product, dataSource: results.dataSource }}
              />
            ))}
          </div>
          {results.products.length === 0 && query && (
            <div className="text-center py-16">
              <p className="text-lg font-medium text-black mb-2">
                Sonuç bulunamadı
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Farklı anahtar kelimeler veya OEM numarası ile tekrar arayın.
              </p>
              <Link
                href="/request"
                className="inline-block bg-black text-white px-6 py-3 text-sm font-medium hover:bg-gray-800 transition-colors rounded"
              >
                Parça Talep Et
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}