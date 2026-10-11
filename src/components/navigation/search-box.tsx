"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchTooShort } from "@/modules/search/query";
import type { SearchSuggestions } from "@/modules/store/search-suggestions";
import { Select } from "@/components/site/select";
import { SiteIcon } from "@/components/site/site-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type SearchBoxProps = {
  variant?: "header" | "hero" | "catalog";
  defaultQuery?: string;
  defaultMode?: "all" | "code";
  category?: string;
  className?: string;
};

const variants = {
  // The header row: hidden on checkout and (on phones) on the home page, which opens it from MobileSearchToggle.
  header: {
    form: "h-10 min-h-10 min-w-[220px] flex-1 rounded-[3px] border-input -mr-2 max-[850px]:mr-0 max-[850px]:min-w-0 max-[600px]:order-3 max-[600px]:w-full max-[600px]:flex-[0_0_100%] group-data-[route=checkout]/route:hidden group-data-[route=home]/route:max-[600px]:hidden",
    select: "w-[164px] min-w-[164px] max-[1100px]:w-[156px] max-[1100px]:min-w-[156px] min-[601px]:max-[850px]:hidden max-[600px]:w-[136px] max-[600px]:min-w-[136px] max-[370px]:w-[125px] max-[370px]:min-w-[125px]",
    trigger: "min-h-[38px] rounded-none bg-[#f8f9f9] py-[9px] pr-8 pl-3",
    input: "h-[38px] px-2.5 py-[9px] max-[600px]:placeholder:text-xs max-[370px]:placeholder:text-[11px]",
    button: "h-[38px] w-10 basis-10 rounded-none bg-white text-foreground hover:bg-[#f7f8fa]",
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

export function SearchBox({ variant = "header", defaultQuery = "", defaultMode = "all", category, className }: SearchBoxProps) {
  const [mode, setMode] = useState(defaultMode);
  const [query, setQuery] = useState(defaultQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const listId = useId();
  const v = variants[variant];
  const suggestions = useSuggestions(query, mode);
  const options = suggestions ? [
    ...suggestions.categories.map(item => ({ href: item.href, label: item.name, detail: "Kategori" })),
    ...suggestions.products.map(item => ({ href: item.href, label: item.name, detail: `${item.brand} · ${item.code}` })),
  ] : [];
  const expanded = open && options.length > 0;
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
    <form ref={form} action="/katalog" role="search" aria-label={variant === "header" ? "Site genelinde parça ara" : "Katalogda parça ara"}
      onSubmit={() => setOpen(false)}
      className={cn("relative flex min-w-0 items-center gap-0 border bg-white text-sm leading-5 transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:shadow-[0_0_0_3px_#0077c714]", v.form, className)}>
      <Select name="searchBy" label="Arama türü" value={mode} className={cn("shrink-0", v.select)}
        triggerClassName={cn("border-0 border-r border-border text-sm hover:border-border hover:bg-[#f7f8fa] max-[600px]:text-sm", v.trigger)}
        options={[{ value: "all", label: "Ürün veya marka" }, { value: "code", label: "Ürün / OEM kodu" }]}
        onChange={value => setMode(value === "code" ? "code" : "all")} />
      <input type="search" name="q" aria-label="Ürün, marka veya OEM koduyla ara" autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        placeholder={mode === "code" ? "Ürün kodu veya OEM numarası" : "Hangi parçayı arıyorsun?"}
        value={query} onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} minLength={2} maxLength={120}
        className={cn("w-0 min-w-0 flex-1 rounded-none border-0 bg-transparent text-sm leading-[22px] text-foreground outline-none placeholder:text-sm placeholder:text-muted-foreground focus:border-0 focus:shadow-none focus:outline-none focus-visible:outline-none", v.input)} />
      {category && <input type="hidden" name="category" value={category} />}
      <button type="submit" aria-label="Parça ara" className={cn("grid min-h-0 shrink-0 place-items-center border-0 p-0", v.button)}><Search size={20} aria-hidden="true" /></button>
      {expanded && <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-50 overflow-hidden rounded-md border border-border bg-white text-left shadow-[0_8px_24px_#212b361f]"
        // Keep focus in the input while choosing with the mouse, so blur does not close the list first.
        onMouseDown={event => event.preventDefault()}>
        {notice && <p className="m-0 border-b border-border px-3.5 py-2 text-xs text-muted-foreground">{notice}</p>}
        <ul id={listId} role="listbox" aria-label="Arama önerileri" className="m-0 max-h-[min(420px,60vh)] list-none overflow-y-auto p-1">
          {options.map((option, index) => <li key={option.href} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
            onMouseEnter={() => setActiveIndex(index)} onClick={() => go(option.href)}
            className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded px-2.5 py-2 text-sm leading-5 max-[600px]:flex-col max-[600px]:gap-0", index === activeIndex && "bg-[#f1f7fb] text-brand")}>
            <span className="min-w-0 max-w-full truncate">{option.label}</span><small className="shrink-0 text-xs text-muted-foreground">{option.detail}</small>
          </li>)}
        </ul>
        <button type="button" onClick={() => { setOpen(false); form.current?.requestSubmit(); }}
          className="block w-full border-0 border-t border-border bg-[#f8f9f9] px-3.5 py-2.5 text-left text-sm font-medium text-primary hover:bg-[#f1f3f5]">“{query.trim()}” için tüm sonuçlar</button>
      </div>}
    </form>
  );
}

/** Phones on the home page: a search icon in the compact header that drops the header search below it. */
export function MobileSearchToggle() {
  return <div className="absolute top-4 left-[54px] z-45 hidden group-data-[route=home]/route:max-[600px]:block">
    <Popover>
      <PopoverTrigger aria-label="Parça aramasını aç" className="grid size-6 min-h-0 cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 hover:bg-transparent">
        <SiteIcon name="search" size={20}/>
      </PopoverTrigger>
      <PopoverContent data-mobile-search="" initialFocus={() => document.querySelector<HTMLInputElement>("[data-mobile-search] input[name=q]")} align="start" alignOffset={-39} sideOffset={16} className="w-[calc(100vw-30px)] gap-0 rounded-none bg-transparent p-0 shadow-none ring-0">
        <SearchBox className="m-0 h-12 min-h-12 w-full shadow-[0_4px_12px_#0002] [&>button:first-of-type]:w-[130px] [&>button:first-of-type]:min-w-[130px] [&>button:first-of-type]:basis-[130px]" />
      </PopoverContent>
    </Popover>
  </div>;
}
