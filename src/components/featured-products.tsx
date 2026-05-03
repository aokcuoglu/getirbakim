"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { FEATURED_TABS } from "@/lib/storefront";
import type { NormalizedProduct } from "@/types";
import { ArrowRight } from "lucide-react";

interface FeaturedProduct extends NormalizedProduct {
  dataSource?: string;
}

export function FeaturedProducts() {
  const [activeTab, setActiveTab] = useState("all");
  const [products, setProducts] = useState<FeaturedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState<string>("");

  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      try {
        let url = "/api/featured";
        const params = new URLSearchParams();
        if (activeTab === "inStock") {
          params.set("inStock", "true");
        } else if (activeTab === "bosch") {
          params.set("q", "Bosch");
        } else if (activeTab === "filtre") {
          params.set("q", "filtre");
        } else if (activeTab === "fren") {
          params.set("q", "fren");
        }

        // Use search API for filtered tabs, featured API for "all"
        if (activeTab !== "all") {
          url = "/api/search";
          if (!params.has("q")) params.set("q", "");
          if (activeTab === "inStock") {
            params.set("sort", "in_stock_first");
          } else if (activeTab === "bosch") {
            params.set("brand", "Bosch");
          }
        }

        const res = await fetch(`${url}?${params.toString()}`);
        const data = await res.json();
        setProducts((data.products || []).slice(0, 8));
        setDataSource(data.dataSource || "");
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, [activeTab]);

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              Öne Çıkan Katalog Ürünleri
            </h2>
            {dataSource === "existing-db" && (
              <p className="text-xs text-muted mt-1">
                Dinamik, SETA ve ParcaTedarik katalog verisinden
              </p>
            )}
          </div>
          <Link
            href="/search?q="
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-dark transition-colors"
          >
            Tümünü gör
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
          {FEATURED_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "bg-accent text-white"
                  : "bg-surface text-muted hover:text-foreground hover:bg-surface-alt"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="animate-pulse bg-surface rounded-lg border border-border">
                <div className="h-40 bg-surface-alt rounded-t-lg" />
                <div className="p-4 space-y-3">
                  <div className="h-3 bg-gray-200 rounded w-16" />
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-6 bg-gray-200 rounded w-1/3 mt-4" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={{ ...product, dataSource: dataSource || product.dataSource }}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-surface rounded-xl border border-border">
            <p className="text-muted mb-4">Öne çıkan ürünler şu anda yüklenemiyor.</p>
            <Link
              href="/search?q="
              className="inline-flex items-center gap-2 text-accent hover:text-accent-dark font-medium"
            >
              Katalogda ara
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}