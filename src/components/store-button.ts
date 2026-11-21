import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Storefront button scale and colour roles (DESIGN.md "Buttons and controls", #1091). Use on ui/button as
 * `<Button className={cn(storeButton({intent,size}),extras)}>`: ui/button stays the registry's (admin uses it as is),
 * and the storefront look lives here instead of in per-file class lists. Every size is at least 44px tall; `compact`
 * drops to 40px only from md up, for pointer toolbars. The `extras` after the call are layout only (width, flex, margin,
 * position, gap, px-0/px-2 on text links, text-left, whitespace-normal, justify-between, responsive hidden): never
 * height, size, font size or brand colours, which belong to the size and intent here.
 *
 * The styles are named classes in src/app/storefront.css (`.store-btn`, `.store-btn-<intent>`, `.store-btn-<size>`,
 * #1134), so the HTML and the RSC payload carry class names instead of 750-970 characters of utilities per button. The
 * classes sit in the components layer: the extras (utilities) win over them, and `cn` (src/lib/utils.ts) removes the
 * ui/button utilities they replace. The three utilities left in the base and the hover background per intent beat
 * ui/button's own `focus-visible:ring-3`, `hover:bg-primary/80` and `disabled:opacity-50`, which `cn` cannot remove.
 */
export const storeButtonSizes = {
  hero: "store-btn-hero",
  lg: "store-btn-lg",
  md: "store-btn-md",
  compact: "store-btn-compact",
  icon: "store-btn-icon",
} as const;

export const storeButtonIntents = {
  primary: "store-btn-primary hover:bg-brand-strong disabled:opacity-100",
  secondary: "store-btn-secondary hover:bg-[color-mix(in_oklch,var(--accent),var(--accent-foreground)_8%)]",
  outline: "store-btn-outline hover:bg-muted",
  ghost: "store-btn-ghost hover:bg-muted",
  link: "store-btn-link hover:bg-transparent",
  danger: "store-btn-danger hover:bg-destructive/20",
} as const;

const variants = cva("store-btn focus-visible:ring-0", {
  variants: { intent: storeButtonIntents, size: storeButtonSizes },
  defaultVariants: { intent: "primary", size: "md" },
});

export type StoreButtonOptions = VariantProps<typeof variants>;

/** The merged class list (later classes win), so it also works on a plain element without ui/button. */
export function storeButton(options: StoreButtonOptions = {}) {
  return cn(variants(options));
}
