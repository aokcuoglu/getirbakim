"use client";

import { useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

export type MatchingFilter = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
};

export function ProductMatchingFilters({ params, placeholder, filters = [], resetHref }: {
  params: Record<string, string | undefined>;
  placeholder: string;
  filters?: MatchingFilter[];
  resetHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = Boolean(params.q || filters.some(filter => filter.value));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === "string" && value.trim()) query.set(key, value.trim());
    });
    startTransition(() => router.push(`/yonetim/urun-eslestirme?${query}`, { scroll: false }));
  }

  return <form action="/yonetim/urun-eslestirme" onSubmit={submit} aria-label="Tablo filtreleri" aria-busy={pending}
    className="flex min-w-0 flex-wrap items-center gap-2">
    {Object.entries(params).filter(([key, value]) => value && key !== "q" && !filters.some(filter => filter.name === key))
      .map(([key, value]) => <input key={key} type="hidden" name={key} value={value}/>)}
    <InputGroup className="w-full sm:w-72">
      <InputGroupInput type="search" name="q" aria-label="Ara" defaultValue={params.q} placeholder={placeholder} maxLength={80}/>
      <InputGroupAddon align="inline-end">
        {active && <InputGroupButton size="icon-xs" aria-label="Filtreleri temizle" title="Filtreleri temizle"
          nativeButton={false} render={<Link href={resetHref} scroll={false}/>}><X aria-hidden="true"/></InputGroupButton>}
        <InputGroupButton type="submit" size="icon-xs" aria-label="Ara" title="Ara" disabled={pending}>
          {pending ? <Spinner aria-hidden="true"/> : <Search aria-hidden="true"/>}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    {filters.map(filter => <NativeSelect key={filter.name} name={filter.name} aria-label={filter.label} defaultValue={filter.value}
      disabled={pending} onChange={event => event.currentTarget.form?.requestSubmit()} className="w-full sm:w-auto">
      {filter.options.map(option => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
    </NativeSelect>)}
  </form>;
}
