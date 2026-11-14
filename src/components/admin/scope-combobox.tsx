"use client";

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

// Dinamik has ~800 brands: the list is searched and shows this many matches at a time.
const LIMIT = 100;

/** Searchable single choice of a sync scope (a Dinamik brand, a Başbuğ group) for a refresh form; submits as `name`. */
export function ScopeCombobox({ id, name, values, defaultValue, className, empty = "Eşleşen kayıt yok." }: {
  id: string;
  name: string;
  values: string[];
  defaultValue?: string;
  className?: string;
  empty?: string;
}) {
  return <Combobox items={values} name={name} defaultValue={defaultValue ?? values[0] ?? null} limit={LIMIT} required>
    <ComboboxInput id={id} className={className} placeholder="Ara…"/>
    <ComboboxContent>
      <ComboboxEmpty>{empty}</ComboboxEmpty>
      <ComboboxList>{(value: string) => <ComboboxItem key={value} value={value}>{value}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
