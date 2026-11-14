"use client";

import { useState } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

export type CategoryOption = { value: string; label: string };

// The Trodo tree has over a thousand categories: the list is searched and shows this many matches at a time.
const LIMIT = 100;

/**
 * Searchable, clearable choice of a store category ("Fren sistemi › Balata"); submits the category id as `name`, or an
 * empty value when cleared. The hidden input carries the value so a cleared choice is submitted too.
 */
export function CategoryCombobox({ id, name, placeholder, options, defaultValue, describedBy, onValueChange }: {
  /** The input's id: the field's FieldLabel names it through htmlFor. */
  id: string;
  name: string;
  placeholder: string;
  options: CategoryOption[];
  defaultValue: string | null;
  describedBy?: string;
  onValueChange?: () => void;
}) {
  const [selected, setSelected] = useState<CategoryOption | null>(options.find(option => option.value === defaultValue) ?? null);
  return <>
    <Combobox items={options} value={selected} onValueChange={value => { setSelected(value); onValueChange?.(); }} limit={LIMIT}
      isItemEqualToValue={(item, value) => item.value === value.value}>
      <ComboboxInput id={id} placeholder={placeholder} aria-describedby={describedBy} showClear/>
      <ComboboxContent>
        <ComboboxEmpty>Eşleşen kategori yok.</ComboboxEmpty>
        <ComboboxList>{(option: CategoryOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    <input type="hidden" name={name} value={selected?.value ?? ""}/>
  </>;
}
