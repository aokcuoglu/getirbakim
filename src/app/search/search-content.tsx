"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import Link from "next/link";
import type { SearchResult, CatalogSearchFilters } from "@/types";
import { AlertCircle, Clock, Database, X, SlidersHorizontal, Search, Tag, Hash, Filter, RotateCcw, Loader2 } from "lucide-react";

const SEARCH_HINTS = [
  { label: "OEM no ile ara", example: "BV6Z3504WT", icon: Hash },
  { label: "Ürün kodu ile ara", example: "ANKA 20100020", icon: Tag },
  { label: "Marka + parça adı ile ara", example: "Bosch filtre", icon: Search },
  { label: "Kategori ile ara", example: "balata", icon: Tag },
];

const SORT_OPTIONS = [
  { value: "relevance", label: "İlgililik" },
  { value: "in_stock_first", label: "Stokta olanlar önce" },
  { value: "price_asc", label: "Fiyat (artan)" },
  { value: "price_desc", label: "Fiyat (azalan)" },
  { value: "updated_desc", label: "Son güncelleme" },
];

export default function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q") ?? "";
  const supplierFilter = searchParams.get("supplier") ?? "";
  const brandFilter = searchParams.get("brand") ?? "";
  const inStockFilter = searchParams.get("inStock") ?? "";
  const minPriceFilter = searchParams.get("minPrice") ?? "";
  const maxPriceFilter = searchParams.get("maxPrice") ?? "";
  const sortFilter = searchParams.get("sort") ?? "relevance";
  const pageParam = parseInt(searchParams.get("page") ?? "1", 10) || 1;

  const [inputValue, setInputValue] = useState(query);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [allProducts, setAllProducts] = useState<SearchResult["products"]>([]);
  const [currentPage, setCurrentPage] = useState(pageParam);
  const [hasMore, setHasMore] = useState(false);
  const localSupplier = searchParams.get("supplier") ?? "";
  const localBrand = searchParams.get("brand") ?? "";
  const localInStock = searchParams.get("inStock") ?? "";
  const localMinPrice = searchParams.get("minPrice") ?? "";
  const localMaxPrice = searchParams.get("maxPrice") ?? "";
  const localSort = searchParams.get("sort") ?? "relevance";

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const isInitialMount = useRef(true);

  function buildSearchUrl(q: string, overrides?: Partial<CatalogSearchFilters & { inStock?: string; page?: number }>) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);

    const s = overrides?.supplier ?? localSupplier;
    const b = overrides?.brand ?? localBrand;
    const is = overrides?.inStock ?? localInStock;
    const mp = overrides?.minPrice?.toString() ?? localMinPrice;
    const xp = overrides?.maxPrice?.toString() ?? localMaxPrice;
    const sort = overrides?.sort ?? localSort;
    const pg = overrides?.page;

    if (s) params.set("supplier", s);
    if (b) params.set("brand", b);
    if (is === "true" || is === "false") params.set("inStock", is);
    if (mp) params.set("minPrice", mp);
    if (xp) params.set("maxPrice", xp);
    if (sort && sort !== "relevance") params.set("sort", sort);
    if (pg && pg > 1) params.set("page", String(pg));

    return `/search?${params.toString()}`;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inputValue.trim()) {
      router.push(buildSearchUrl(inputValue.trim()));
    }
  }

  function handleHintClick(example: string) {
    setInputValue(example);
    router.push(buildSearchUrl(example));
  }

  function removeFilter(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    router.push(`/search?${params.toString()}`);
  }

  const hasActiveFilters = supplierFilter || brandFilter || inStockFilter === "true" || inStockFilter === "false" || minPriceFilter || maxPriceFilter || (sortFilter && sortFilter !== "relevance");

  const fetchPage = useCallback(async (q: string, page: number, append: boolean) => {
    const currentSearchId = ++searchIdRef.current;
    const controller = new AbortController();

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = controller;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    const params = new URLSearchParams();
    params.set("q", q);
    params.set("page", String(page));
    params.set("limit", "24");
    if (supplierFilter) params.set("supplier", supplierFilter);
    if (brandFilter) params.set("brand", brandFilter);
    if (inStockFilter === "true" || inStockFilter === "false") params.set("inStock", inStockFilter);
    if (minPriceFilter) params.set("minPrice", minPriceFilter);
    if (maxPriceFilter) params.set("maxPrice", maxPriceFilter);
    if (sortFilter && sortFilter !== "relevance") params.set("sort", sortFilter);

    try {
      const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
      if (res.status === 429) {
        const data = await res.json();
        throw new Error(data.error ?? "Çok fazla istek");
      }
      const data: SearchResult = await res.json();

      if (searchIdRef.current !== currentSearchId) return;
      if (controller.signal.aborted) return;

      if (append) {
        setAllProducts((prev) => [...prev, ...data.products]);
      } else {
        setAllProducts(data.products);
      }
      setResults(data);
      setHasMore(data.hasMore ?? false);
      setCurrentPage(page);
      setLoading(false);
      setLoadingMore(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (searchIdRef.current !== currentSearchId) return;
      if (!append) {
        setResults({
          products: [],
          total: 0,
          query: q,
          errors: [
            {
              supplierId: "system",
              supplierName: "Sistem",
              error: err instanceof Error ? err.message : "Arama sırasında bir hata oluştu",
            },
          ],
        });
        setAllProducts([]);
      }
      setLoading(false);
      setLoadingMore(false);
    }
  }, [supplierFilter, brandFilter, inStockFilter, minPriceFilter, maxPriceFilter, sortFilter]);

  useEffect(() => {
    if (!query) {
      setResults(null);
      setAllProducts([]);
      return;
    }

    if (isInitialMount.current) {
      isInitialMount.current = false;
      fetchPage(query, 1, false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchPage(query, 1, false);
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, supplierFilter, brandFilter, inStockFilter, minPriceFilter, maxPriceFilter, sortFilter]);

  function loadMore() {
    if (loadingMore || !hasMore) return;
    fetchPage(query, currentPage + 1, true);
  }

  function clearFilters() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    router.push(`/search?${params.toString()}`);
  }

  const displayedProducts = allProducts.length > 0 ? allProducts : (results?.products ?? []);
  const isFromDb = results?.dataSource === "existing-db";

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Search Bar */}
      <div className="mb-6">
        <form onSubmit={handleSubmit}>
          <div className="flex items-center border-2 border-primary rounded-lg overflow-hidden focus-within:border-accent transition-colors bg-white">
            <div className="flex items-center pl-4 text-muted">
              <Search className="h-5 w-5" />
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="OEM no, parça kodu, marka veya ürün adı ara..."
              className="flex-1 border-0 bg-transparent px-3 h-12 text-sm text-foreground placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              className="h-12 px-6 bg-accent hover:bg-accent-dark text-white font-medium transition-colors shrink-0 flex items-center gap-2"
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Ara</span>
            </button>
          </div>
        </form>

        {!query && (
          <div className="mt-6 space-y-3">
            <p className="text-sm font-medium text-foreground">Nasıl aramak istersiniz?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SEARCH_HINTS.map((hint) => (
                <button
                  key={hint.example}
                  onClick={() => handleHintClick(hint.example)}
                  className="flex items-start gap-3 p-4 border border-border rounded-xl hover:border-accent/30 hover:shadow-sm bg-white transition-all text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent/5 border border-accent/10 flex items-center justify-center shrink-0">
                    <hint.icon className="h-4 w-4 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{hint.label}</p>
                    <p className="text-xs text-muted">{hint.example}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {query && (
        <div className="flex gap-6">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24 bg-white border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filtreler
                </h3>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="text-xs text-accent hover:text-accent-dark flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" />
                    Temizle
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Tedarikçi</label>
                  <select
                    value={localSupplier}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value) params.set("supplier", e.target.value); else params.delete("supplier");
                      router.push(`/search?${params.toString()}`);
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    <option value="">Tümü</option>
                    <option value="Dinamik">Dinamik</option>
                    <option value="SETA">SETA</option>
                    <option value="ParcaTedarik">ParçaTedarik</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Marka</label>
                  <input
                    type="text"
                    defaultValue={localBrand}
                    onBlur={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value) params.set("brand", e.target.value); else params.delete("brand");
                      router.push(`/search?${params.toString()}`);
                    }}
                    placeholder="Örn: Bosch, Valeo..."
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Stok Durumu</label>
                  <select
                    value={localInStock}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value) params.set("inStock", e.target.value); else params.delete("inStock");
                      router.push(`/search?${params.toString()}`);
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    <option value="">Tümü</option>
                    <option value="true">Stokta var</option>
                    <option value="false">Stokta yok</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Min. ₺</label>
                    <input
                      type="number"
                      defaultValue={localMinPrice}
                      onBlur={(e) => {
                        const params = new URLSearchParams(searchParams.toString());
                        if (e.target.value) params.set("minPrice", e.target.value); else params.delete("minPrice");
                        router.push(`/search?${params.toString()}`);
                      }}
                      placeholder="0"
                      min="0"
                      step="10"
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Max. ₺</label>
                    <input
                      type="number"
                      defaultValue={localMaxPrice}
                      onBlur={(e) => {
                        const params = new URLSearchParams(searchParams.toString());
                        if (e.target.value) params.set("maxPrice", e.target.value); else params.delete("maxPrice");
                        router.push(`/search?${params.toString()}`);
                      }}
                      placeholder="10000"
                      min="0"
                      step="10"
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Sıralama</label>
                  <select
                    value={localSort}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value === "relevance") params.delete("sort"); else params.set("sort", e.target.value);
                      router.push(`/search?${params.toString()}`);
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </aside>

          {/* Results Area */}
          <div className="flex-1 min-w-0">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-4 gap-4">
              <div className="text-sm text-muted">
                {loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aranıyor...</span>
                ) : results ? (
                  <>&ldquo;{query}&rdquo; için <span className="font-semibold text-foreground">{results.total ?? results.products.length}</span> sonuç bulundu</>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {/* Mobile Filter Toggle */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden flex items-center gap-1.5 text-sm text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-surface transition-colors"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filtreler
                  {hasActiveFilters && (
                    <span className="w-2 h-2 rounded-full bg-accent" />
                  )}
                </button>
                {/* Sort Dropdown (desktop) */}
                <div className="hidden sm:block">
                  <select
                    value={sortFilter}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value === "relevance") {
                        params.delete("sort");
                      } else {
                        params.set("sort", e.target.value);
                      }
                      router.push(`/search?${params.toString()}`);
                    }}
                    className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Active Filter Chips */}
            {hasActiveFilters && (
              <div className="flex flex-wrap gap-2 mb-4">
                {supplierFilter && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/5 text-primary px-2.5 py-1 rounded-full border border-primary/10">
                    Tedarikçi: {supplierFilter}
                    <button onClick={() => removeFilter("supplier")} className="hover:text-accent-dark"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {brandFilter && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/5 text-primary px-2.5 py-1 rounded-full border border-primary/10">
                    Marka: {brandFilter}
                    <button onClick={() => removeFilter("brand")} className="hover:text-accent-dark"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {inStockFilter === "true" && (
                  <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-200">
                    Stokta var
                    <button onClick={() => removeFilter("inStock")} className="hover:text-green-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {inStockFilter === "false" && (
                  <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-full border border-red-200">
                    Stokta yok
                    <button onClick={() => removeFilter("inStock")} className="hover:text-red-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {minPriceFilter && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/5 text-primary px-2.5 py-1 rounded-full border border-primary/10">
                    Min: ₺{Number(minPriceFilter).toLocaleString("tr-TR")}
                    <button onClick={() => removeFilter("minPrice")} className="hover:text-accent-dark"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {maxPriceFilter && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/5 text-primary px-2.5 py-1 rounded-full border border-primary/10">
                    Max: ₺{Number(maxPriceFilter).toLocaleString("tr-TR")}
                    <button onClick={() => removeFilter("maxPrice")} className="hover:text-accent-dark"><X className="h-3 w-3" /></button>
                  </span>
                )}
                <button
                  onClick={clearFilters}
                  className="text-xs text-muted hover:text-foreground underline"
                >
                  Tümünü temizle
                </button>
              </div>
            )}

            {/* Data Source Banner */}
            {isFromDb && results && (results.total ?? results.products.length) > 0 && (
              <div className="mb-5 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                <div className="flex items-start gap-2">
                  <Database className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Katalog verisi ile arama</p>
                    <p className="mt-0.5 text-blue-700">
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
                      <p className="mt-1 text-blue-600">Canlı tedarikçi API&apos;lerinden de sonuçlar eklendi.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Error Banner */}
            {results?.errors && results.errors.length > 0 && (
              <div className="mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-xs text-yellow-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p>Bazı tedarikçilerden yanıt alınamadı, mevcut sonuçlar gösteriliyor.</p>
                    {results.errors.map((err, i) => (
                      <p key={i} className="mt-1 text-yellow-700">{err.supplierName}: {err.error}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {results?.lastCheckedAt && (
              <div className="mb-4 flex items-center gap-1.5 text-xs text-muted">
                <Clock className="h-3.5 w-3.5" />
                <span>Son kontrol: {new Date(results.lastCheckedAt).toLocaleString("tr-TR")}</span>
              </div>
            )}

            {/* Loading Skeletons */}
            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="animate-pulse bg-white border border-border rounded-lg">
                    <div className="h-40 bg-surface-alt rounded-t-lg" />
                    <div className="p-4 space-y-3">
                      <div className="h-3 bg-gray-200 rounded w-1/3" />
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-200 rounded w-1/2" />
                      <div className="h-4 bg-gray-200 rounded w-1/4 mt-4" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Results Grid */}
            {results && !loading && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {displayedProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={{ ...product, dataSource: results.dataSource }}
                    />
                  ))}
                </div>

                {/* Load More Button */}
                {hasMore && (
                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="flex items-center gap-2 bg-accent hover:bg-accent-dark text-white px-8 py-3 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Yükleniyor...
                        </>
                      ) : (
                        "Daha fazla göster"
                      )}
                    </button>
                  </div>
                )}

                {displayedProducts.length === 0 && query && (
                  <div className="text-center py-16">
                    <p className="text-lg font-semibold text-foreground mb-2">Sonuç bulunamadı</p>
                    <p className="text-sm text-muted mb-6">
                      Farklı anahtar kelimeler, OEM numarası veya ürün kodu ile tekrar arayın.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      {SEARCH_HINTS.map((hint) => (
                        <button
                          key={hint.example}
                          onClick={() => handleHintClick(hint.example)}
                          className="text-xs bg-surface text-foreground px-3 py-1.5 rounded-full hover:bg-surface-alt transition-colors border border-border"
                        >
                          {hint.label}: {hint.example}
                        </button>
                      ))}
                    </div>
                    <Link
                      href="/request"
                      className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dark text-white px-6 py-3 text-sm font-semibold rounded-lg transition-colors"
                    >
                      Parça Talep Et
                    </Link>
                    <p className="mt-3 text-xs text-muted">
                      Yanlış parça riskini azaltmak için talep sonrası uyumluluk teyidi yapılır.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile Filter Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 w-80 max-w-full bg-white shadow-xl overflow-y-auto animate-fade-in">
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filtreler
                </h3>
                <button onClick={() => setSidebarOpen(false)} className="p-1 text-muted hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Tedarikçi</label>
                  <select
                    value={localSupplier}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value) params.set("supplier", e.target.value); else params.delete("supplier");
                      router.push(`/search?${params.toString()}`);
                      setSidebarOpen(false);
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    <option value="">Tümü</option>
                    <option value="Dinamik">Dinamik</option>
                    <option value="SETA">SETA</option>
                    <option value="ParcaTedarik">ParçaTedarik</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Marka</label>
                  <input
                    type="text"
                    defaultValue={localBrand}
                    onBlur={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value) params.set("brand", e.target.value); else params.delete("brand");
                      router.push(`/search?${params.toString()}`);
                    }}
                    placeholder="Örn: Bosch, Valeo..."
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Stok Durumu</label>
                  <select
                    value={localInStock}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value) params.set("inStock", e.target.value); else params.delete("inStock");
                      router.push(`/search?${params.toString()}`);
                      setSidebarOpen(false);
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    <option value="">Tümü</option>
                    <option value="true">Stokta var</option>
                    <option value="false">Stokta yok</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Min. ₺</label>
                    <input
                      type="number"
                      defaultValue={localMinPrice}
                      onBlur={(e) => {
                        const params = new URLSearchParams(searchParams.toString());
                        if (e.target.value) params.set("minPrice", e.target.value); else params.delete("minPrice");
                        router.push(`/search?${params.toString()}`);
                      }}
                      placeholder="0"
                      min="0"
                      step="10"
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Max. ₺</label>
                    <input
                      type="number"
                      defaultValue={localMaxPrice}
                      onBlur={(e) => {
                        const params = new URLSearchParams(searchParams.toString());
                        if (e.target.value) params.set("maxPrice", e.target.value); else params.delete("maxPrice");
                        router.push(`/search?${params.toString()}`);
                      }}
                      placeholder="10000"
                      min="0"
                      step="10"
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Sıralama</label>
                  <select
                    value={localSort}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value === "relevance") params.delete("sort"); else params.set("sort", e.target.value);
                      router.push(`/search?${params.toString()}`);
                      setSidebarOpen(false);
                    }}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent bg-white"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => {
                      router.push(buildSearchUrl(query));
                      setSidebarOpen(false);
                    }}
                    className="flex-1 bg-accent hover:bg-accent-dark text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                  >
                    Uygula
                  </button>
                  {hasActiveFilters && (
                    <button
                      onClick={() => {
                        clearFilters();
                        setSidebarOpen(false);
                      }}
                      className="px-4 border border-border text-sm font-medium text-foreground rounded-lg hover:bg-surface transition-colors"
                    >
                      Temizle
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sort Dropdown */}
      {query && (
        <div className="sm:hidden mt-4">
          <select
            value={sortFilter}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString());
              if (e.target.value === "relevance") {
                params.delete("sort");
              } else {
                params.set("sort", e.target.value);
              }
              router.push(`/search?${params.toString()}`);
            }}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent bg-white"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}