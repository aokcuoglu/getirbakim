"use client";

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

export type CategoryOption = { value: string; label: string };

// The Trodo tree has over a thousand categories: the list is searched and shows this many matches at a time.
const LIMIT = 100;

/**
 * Searchable, clearable choice of a store category ("Fren sistemi › Balata"), controlled by the form: `value` is the
 * category id ("" for none) and is submitted as `name` through a hidden input, so a cleared choice is submitted too.
 */
export function CategoryCombobox({ id, name, placeholder, options, value, onValueChange, describedBy }: {
  /** The input's id: the field's FieldLabel names it through htmlFor. */
  id: string;
  name: string;
  placeholder: string;
  options: CategoryOption[];
  value: string;
  onValueChange: (value: string) => void;
  describedBy?: string;
}) {
  const selected = options.find(option => option.value === value) ?? null;
  return <>
    <Combobox items={options} value={selected} onValueChange={option => onValueChange(option?.value ?? "")} limit={LIMIT}
      isItemEqualToValue={(item, current) => item.value === current.value}>
      <ComboboxInput id={id} placeholder={placeholder} aria-describedby={describedBy} showClear/>
      <ComboboxContent>
        <ComboboxEmpty>Eşleşen kategori yok.</ComboboxEmpty>
        <ComboboxList>{(option: CategoryOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    <input type="hidden" name={name} value={value}/>
  </>;
}
