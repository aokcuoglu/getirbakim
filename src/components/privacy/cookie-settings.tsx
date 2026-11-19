"use client";

import { Checkbox } from "@/components/ui/checkbox";

export type CookieOptionKey = "necessary" | "analytics" | "marketing";

const focusSettings = (node: HTMLFieldSetElement | null) => node?.focus({ preventScroll: true });

/**
 * The banner's per-category checkboxes (Base UI checkbox), loaded when "Tercihleri ayarla" or the footer's
 * "Çerez tercihleri" is first hovered, focused or clicked (#1017); the banner keeps the choices and saves them.
 */
export function CookieSettings({ options, checked, setters }: {
  options: readonly { key: CookieOptionKey; title: string; text: string }[];
  checked: Record<CookieOptionKey, boolean>;
  setters: Record<CookieOptionKey, ((value: boolean) => void) | undefined>;
}) {
  return <fieldset id="cookie-settings" tabIndex={-1} ref={focusSettings} className="m-0 mb-3.5 grid min-w-0 gap-3.5 rounded-[4px] border border-[#dfe4e9] px-4 py-3 outline-none max-[600px]:p-2.5">
    <legend className="px-1.5 text-[13px] font-semibold">Çerez tercihlerinizi ayarlayın</legend>
    {options.map(option => <label key={option.key} className="flex cursor-pointer items-start gap-2.5">
      <Checkbox checked={checked[option.key]} disabled={option.key === "necessary"} onCheckedChange={value => setters[option.key]?.(value === true)}
        className="mt-0.5 size-[17px] min-h-0 rounded-[3px] border-[#767676] bg-white p-0 data-checked:border-primary data-checked:bg-primary data-disabled:opacity-100 data-disabled:data-checked:border-[#c4cdd5] data-disabled:data-checked:bg-[#c4cdd5]" />
      <span><strong className="block text-xs leading-5 font-semibold">{option.title}</strong><small className="block text-xs leading-[19px] text-muted-foreground">{option.text}</small></span>
    </label>)}
  </fieldset>;
}
