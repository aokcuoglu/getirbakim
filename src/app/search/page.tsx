import type { Metadata } from "next";
import { Suspense } from "react";
import SearchPageContent from "./search-content";

export const metadata: Metadata = {
  title: "Ürün Arama",
  description:
    "Yedek parça arayın. OEM numarası, parça kodu veya ürün adı ile birden fazla tedarikçinin stok ve fiyat bilgilerini karşılaştırın.",
};

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchLoading />}>
      <SearchPageContent />
    </Suspense>
  );
}

function SearchLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="animate-pulse">
        <div className="h-12 bg-gray-200 rounded w-full mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-52 bg-gray-100 rounded-md border border-gray-200"
            />
          ))}
        </div>
      </div>
    </div>
  );
}