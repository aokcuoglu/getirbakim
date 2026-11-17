"use client";

import {useState} from "react";
import {Search} from "lucide-react";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import {looksLikePartCode} from "@/modules/search/query";
import {catalogPath} from "@/modules/seo/paths";

/** The home hero's part search: a plain GET form to the catalog; a part-number-looking query searches by code. */
export function HomeHeroSearch({className}: {className?: string}) {
  const [query, setQuery] = useState("");
  return <form action={catalogPath} role="search" aria-label="Parça ara" className={cn("flex min-w-0 gap-2.5", className)}>
    <Input type="search" name="q" value={query} onChange={event => setQuery(event.target.value)} aria-label="Parça adı, marka veya OEM kodu" placeholder="Parça adı, marka veya OEM kodu" minLength={2} maxLength={120} required
      className="h-14 min-h-0 min-w-0 flex-1 rounded-md border-white bg-white px-3 text-sm text-foreground focus-visible:ring-0 md:text-sm"/>
    {looksLikePartCode(query) && <input type="hidden" name="searchBy" value="code"/>}
    <Button type="submit" aria-label="Parça ara" className="size-14 min-h-0 rounded-md border-brand bg-brand text-white hover:border-brand-strong hover:bg-brand-strong [&_svg:not([class*='size-'])]:size-5"><Search aria-hidden="true"/></Button>
  </form>;
}
