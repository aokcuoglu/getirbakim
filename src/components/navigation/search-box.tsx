"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/select";

type SearchBoxProps = {
  variant?: "header" | "hero" | "catalog";
  defaultQuery?: string;
  defaultMode?: "all" | "code";
  category?: string;
};

export function SearchBox({ variant = "header", defaultQuery = "", defaultMode = "all", category }: SearchBoxProps) {
  const [mode, setMode] = useState(defaultMode);
  return (
    <form action="/katalog" className={`market-search ${variant === "header" ? "header-search" : `market-search-${variant}`}`} role="search" aria-label={variant === "header" ? "Site genelinde parça ara" : "Katalogda parça ara"}>
      <Select name="searchBy" label="Arama türü" value={mode} className="search-select"
        options={[{ value: "all", label: "Ürün veya marka" }, { value: "code", label: "Ürün / OEM kodu" }]}
        onChange={value => setMode(value === "code" ? "code" : "all")} />
      <input type="search" name="q" aria-label="Ürün, marka veya OEM koduyla ara"
        placeholder={mode === "code" ? "Ürün kodu veya OEM numarası" : "Hangi parçayı arıyorsun?"}
        defaultValue={defaultQuery} maxLength={120} />
      {category && <input type="hidden" name="category" value={category} />}
      <button type="submit" aria-label="Parça ara"><Search size={20} aria-hidden="true" /></button>
    </form>
  );
}
