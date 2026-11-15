"use client";

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

export type ComboboxOption = { value: string; label: string };

// The Trodo tree has over a thousand categories and the master brand list several hundred brands: the list is
// searched and shows this many matches at a time.
const LIMIT = 100;

/**
 * Searchable, clearable choice from a long list (a store category "Fren sistemi › Balata", a master brand), controlled
 * by the form: `value` is the option's value ("" for none) and is submitted as `name` through a hidden input, so a
 * cleared choice is submitted too.
 */
export function OptionCombobox({ id, name, placeholder, emptyText, options, value, onValueChange, describedBy }: {
  /** The input's id: the field's FieldLabel names it through htmlFor. */
  id: string;
  name: string;
  placeholder: string;
  /** Shown when the search matches no option. */
  emptyText: string;
  options: ComboboxOption[];
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
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>{(option: ComboboxOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    <input type="hidden" name={name} value={value}/>
  </>;
}
