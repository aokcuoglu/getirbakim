import type { ChangeEvent } from "react";

/**
 * The storefront filter and compare checkbox: a native input styled by one `.store-check` class (storefront.css), with
 * ui/checkbox's look and the store colours, instead of Base UI's button, hidden input and icon on each of the ~90
 * options and 60 cards per listing (#642). Wrap it in a label: the label carries the text and the touch target.
 */
export function StoreCheckbox({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
 return <input type="checkbox" className="store-check" checked={checked} disabled={disabled} onChange={onChange}/>;
}
