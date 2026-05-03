"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface SearchBarProps {
  initialQuery?: string;
  size?: "lg" | "md" | "hero";
}

export function SearchBar({ initialQuery = "", size = "md" }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  const heightClass = size === "hero" ? "h-14" : size === "lg" ? "h-12" : "h-10";
  const btnSize = size === "hero" ? "h-14 w-20" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const inputText = size === "hero" ? "text-base" : size === "lg" ? "text-sm" : "text-sm";

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className={`flex items-center border-2 border-primary rounded-lg overflow-hidden focus-within:border-accent transition-colors bg-white ${heightClass}`}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={size === "hero" ? "OEM no, parça kodu, marka veya ürün adı ara" : "Parça adı, OEM numarası veya marka ara..."}
          className={`flex-1 border-0 bg-transparent px-4 text-foreground placeholder:text-muted focus:outline-none focus:ring-0 ${inputText}`}
        />
        <button
          type="submit"
          className={`flex items-center justify-center bg-accent hover:bg-accent-dark text-white transition-colors shrink-0 ${btnSize}`}
        >
          {size === "hero" ? (
            <span className="flex items-center gap-2 text-sm font-medium">
              <Search className="h-5 w-5" />
              Parça Ara
            </span>
          ) : (
            <Search className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
          )}
        </button>
      </div>
    </form>
  );
}