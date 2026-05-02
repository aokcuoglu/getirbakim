"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface SearchBarProps {
  initialQuery?: string;
  size?: "lg" | "md";
}

export function SearchBar({ initialQuery = "", size = "lg" }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className={`flex items-center border border-gray-300 bg-white rounded-md overflow-hidden focus-within:border-black transition-colors ${size === "lg" ? "h-14" : "h-10"}`}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Parça adı, OEM numarası veya marka ara..."
          className={`flex-1 border-0 bg-transparent px-4 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 ${size === "lg" ? "text-lg" : "text-sm"}`}
        />
        <button
          type="submit"
          className={`flex items-center justify-center bg-black text-white hover:bg-gray-800 transition-colors ${size === "lg" ? "h-14 w-14" : "h-10 w-10"}`}
        >
          <Search className={size === "lg" ? "h-6 w-6" : "h-4 w-4"} />
        </button>
      </div>
    </form>
  );
}