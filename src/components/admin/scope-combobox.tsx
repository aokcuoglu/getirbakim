"use client";

import { useState } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

// Dinamik has ~800 brands: the list is searched and shows this many matches at a time.
const LIMIT = 100;
const normalize = (text: string) => text.toLocaleLowerCase("tr");

/** Searchable single choice of a sync scope (a Dinamik brand, a Başbuğ group) for a refresh form; submits as `name`. */
export function ScopeCombobox({ id, name, label, placeholder, values, defaultValue, className, empty = "Eşleşen kayıt yok." }: {
  id: string;
  name: string;
  /** Accessible name of the input (the field's visible label says the same). */
  label: string;
  placeholder: string;
  values: string[];
  defaultValue?: string;
  className?: string;
  empty?: string;
}) {
  const initial = defaultValue ?? values[0] ?? null;
  const [selected, setSelected] = useState<string | null>(initial);
  const [query, setQuery] = useState(initial ?? "");
  // The input shows the chosen value until the user types; only a typed query narrows the list.
  const needle = query && query !== selected ? normalize(query) : "";
  const matches = needle ? values.filter(value => normalize(value).includes(needle)).length : values.length;
  return <Combobox items={values} name={name} defaultValue={initial} limit={LIMIT} required
    onValueChange={value => setSelected(value)} onInputValueChange={value => setQuery(value)}>
    <ComboboxInput id={id} className={className} placeholder={placeholder} aria-label={label}/>
    <ComboboxContent>
      <ComboboxEmpty>{empty}</ComboboxEmpty>
      <ComboboxList>{(value: string) => <ComboboxItem key={value} value={value}>{value}</ComboboxItem>}</ComboboxList>
      {matches > LIMIT && <p className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">İlk {LIMIT} / {matches.toLocaleString("tr-TR")} sonuç gösteriliyor; aramayı daraltın.</p>}
    </ComboboxContent>
  </Combobox>;
}
