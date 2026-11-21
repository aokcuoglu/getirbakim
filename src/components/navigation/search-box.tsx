"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, Package, Search } from "lucide-react";
import { searchTooShort } from "@/modules/search/query";
import type { SearchSuggestions } from "@/modules/store/search-suggestions";
import { Select } from "@/components/site/select";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";
import { catalogPath, searchPath } from "@/modules/seo/paths";
import { clearRecentSearches, readRecentSearches, saveRecentSearch, type RecentSearch } from "./recent-searches";

type SearchBoxProps = {
  variant?: "header" | "hero" | "catalog";
  defaultQuery?: string;
  defaultMode?: "all" | "code";
  className?: string;
};

const variants = {
  // The header row: hidden on checkout; on phones its own full-width row, the mode selector an icon beside its chevron (#1089).
  // The phone form is 44px tall with its border, so the selector and the submit button fill its 42px inside.
  header: {
    form: "h-10 min-h-10 min-w-[220px] flex-1 rounded-[3px] border-input -mr-2 max-[850.98px]:mr-0 max-[850.98px]:min-w-0 max-[600px]:order-3 max-[600px]:w-full max-[600px]:flex-[0_0_100%] max-[600px]:h-11 max-[600px]:min-h-11 group-data-[route=checkout]/route:hidden",
    select: "w-[164px] min-w-[164px] min-[851px]:max-[1100px]:w-[156px] min-[851px]:max-[1100px]:min-w-[156px] min-[600px]:max-[850.98px]:w-[84px] max-[600px]:w-[52px] max-[600px]:min-w-[52px]",
    trigger: "min-h-[38px] rounded-none bg-[#f8f9f9] py-[9px] pr-8 pl-3 min-[600px]:max-[850.98px]:min-w-0 min-[600px]:max-[850.98px]:pr-7 min-[600px]:max-[850.98px]:pl-2.5 max-[600px]:min-h-[42px] max-[600px]:pr-0 max-[600px]:pl-2",
    input: "h-[38px] px-2.5 py-[9px] max-[600px]:h-[42px] max-[600px]:placeholder:text-[13px] max-[370px]:px-2",
    button: "h-[38px] w-10 basis-10 max-[600px]:h-[42px] max-[600px]:w-11 max-[600px]:basis-11 rounded-none bg-white text-foreground hover:bg-muted",
  },
  hero: {
    form: "mx-auto mt-8 min-h-[68px] max-w-[800px] rounded-full border-[#d8dde3] p-2 shadow-[0_4px_16px_#212b360a]",
    select: "w-[188px] min-w-[188px]",
    trigger: "min-h-[50px] rounded-l-full bg-transparent pl-5",
    input: "h-[50px] pl-6 text-base placeholder:text-base",
    button: "h-[50px] basis-[50px] rounded-full bg-brand text-white hover:bg-brand-strong",
  },
  catalog: {
    form: "rounded-full border-[#d8dde3] p-1.5",
    select: "w-[164px] min-w-[164px]",
    trigger: "min-h-[38px] rounded-l-full bg-transparent pl-3.5",
    input: "h-[38px] px-4",
    button: "h-[38px] basis-[38px] rounded-full bg-brand text-white hover:bg-brand-strong",
  },
};

// Type-ahead answers for what is typed now; older answers are dropped while the next one loads.
function useSuggestions(query: string, mode: "all" | "code") {
  const [result, setResult] = useState<{ key: string; data: SearchSuggestions } | null>(null);
  const key = `${mode}:${query.trim()}`;
  const active = !searchTooShort(query);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?${new URLSearchParams({ q: query.trim(), searchBy: mode })}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then((data: SearchSuggestions | null) => { if (data) setResult({ key, data }); })
        .catch(() => {});
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, key, mode, query]);
  return active && result?.key === key ? result.data : null;
}

export function SearchBox({ variant = "header", defaultQuery = "", defaultMode = "all", className }: SearchBoxProps) {
  const [mode, setMode] = useState(defaultMode);
  const [query, setQuery] = useState(defaultQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const listId = useId();
  const v = variants[variant];
  const suggestions = useSuggestions(query, mode);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const showRecent = variant === "header" && query.trim() === "" && recent.length > 0;
  const options = showRecent ? recent.map(({ q, mode: recentMode }) => ({ href: searchPath({ q, searchBy: recentMode === "code" ? "code" : undefined }), label: q, detail: recentMode === "code" ? "Kod araması" : "" })) : suggestions ? [
    ...suggestions.categories.map(item => ({ href: item.href, label: item.name, detail: "Kategori" })),
    ...suggestions.products.map(item => ({ href: item.href, label: item.name, detail: item.detail })),
  ] : [];
  const expanded = open && options.length > 0;
  function forgetRecent() { clearRecentSearches(); setRecent([]); }
  const go = (href: string) => { setOpen(false); router.push(href); };
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault(); setOpen(true);
      setActiveIndex(index => event.key === "ArrowDown" ? (index + 1) % options.length : (index <= 0 ? options.length : index) - 1);
    }
    if (event.key === "Enter" && expanded && activeIndex >= 0) { event.preventDefault(); go(options[activeIndex].href); }
  }
  const notice = suggestions?.vehicleScope ? `“${suggestions.vehicleScope.vehicleText}” için “${suggestions.vehicleScope.productText}”`
    : suggestions?.correctedQuery ? `“${suggestions.correctedQuery}” için öneriler` : null;
  return (
    <form ref={form} action={catalogPath} role="search" aria-label={variant === "header" ? "Site genelinde parça ara" : "Katalogda parça ara"}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onSubmit={() => { setOpen(false); saveRecentSearch(query, mode); }}
      className={cn("relative flex min-w-0 items-center gap-0 border bg-white text-sm leading-5 transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:shadow-[0_0_0_3px_#0077c714]", v.form, className)}>
      <Select name="searchBy" label="Arama türü" tabletShort={variant === "header"} value={mode} className={cn("shrink-0", v.select)}
        triggerClassName={cn("border-0 border-r border-border text-sm hover:border-border hover:bg-[#f7f8fa] max-[600px]:text-sm", v.trigger)}
        contentClassName="min-w-[200px]"
        options={[
          { value: "all", label: "Ürün veya marka", shortLabel: "Ürün/marka", tinyLabel: "Ürün", icon: <Package size={16} aria-hidden="true" /> },
          { value: "code", label: "Ürün / OEM kodu", shortLabel: "OEM/kod", tinyLabel: "OEM", icon: <Hash size={16} aria-hidden="true" /> },
        ]}
        onChange={value => setMode(value === "code" ? "code" : "all")} />
      <input type="search" name="q" aria-label="Ürün, marka veya OEM koduyla ara" autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        placeholder={variant === "header" ? (mode === "code" ? "Ürün kodu veya OEM no" : "Parça veya marka ara") : (mode === "code" ? "Ürün kodu veya OEM numarası" : "Hangi parçayı arıyorsun?")}
        value={query} onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
        onFocus={() => { setRecent(readRecentSearches()); setOpen(true); }} onKeyDown={onKeyDown} minLength={2} maxLength={120}
        className={cn("w-0 min-w-0 flex-1 rounded-none border-0 bg-transparent text-sm leading-[22px] text-foreground outline-none placeholder:text-sm placeholder:text-muted-foreground focus:border-0 focus:shadow-none focus:outline-none focus-visible:outline-none", v.input)} />
      <button type="submit" aria-label="Parça ara" className={cn("grid min-h-0 shrink-0 place-items-center border-0 p-0", v.button)}><Search size={20} aria-hidden="true" /></button>
      {expanded && <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-50 overflow-hidden rounded-md border border-border bg-white text-left shadow-[0_8px_24px_#212b361f]"
        // Keep focus in the input while choosing with the mouse, so blur does not close the list first.
        onMouseDown={event => event.preventDefault()}>
        {showRecent && <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-1 text-xs text-muted-foreground"><span>Son aramalar</span><Button type="button" variant="link" aria-label="Son aramaları temizle" onClick={forgetRecent} className={cn(storeButton({intent:"link",size:"md"}),"px-0")}>Temizle</Button></div>}
        {!showRecent && notice && <p className="m-0 border-b border-border px-3.5 py-2 text-xs text-muted-foreground">{notice}</p>}
        <ul id={listId} role="listbox" aria-label={showRecent ? "Son aramalar" : "Arama önerileri"} className="m-0 max-h-[min(420px,60vh)] list-none overflow-y-auto p-1">
          {options.map((option, index) => <li key={option.href} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
            onMouseEnter={() => setActiveIndex(index)} onClick={() => go(option.href)}
            className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded px-2.5 py-2 text-sm leading-5 max-[600px]:min-h-11 max-[600px]:flex-col max-[600px]:justify-center max-[600px]:gap-0", index === activeIndex && "bg-[#f1f7fb] text-brand")}>
            <span className="min-w-0 max-w-full truncate">{option.label}</span><small className="shrink-0 text-xs text-muted-foreground">{option.detail}</small>
          </li>)}
        </ul>
        {!showRecent && <div className="border-t border-border p-1"><Button type="button" variant="secondary" onClick={() => { setOpen(false); form.current?.requestSubmit(); }}
          className={cn(storeButton({intent:"secondary",size:"md"}),"w-full justify-start text-left whitespace-normal")}>“{query.trim()}” için tüm sonuçlar</Button></div>}
      </div>}
    </form>
  );
}
