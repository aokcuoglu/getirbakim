import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Storefront button scale and colour roles (DESIGN.md "Buttons and controls", #1091). Use on ui/button as
 * `<Button className={cn(storeButton({intent,size}),extras)}>`: ui/button stays the registry's (admin uses it as is),
 * and the storefront look lives here instead of in per-file class lists. Every size is at least 44px tall; `compact`
 * drops to 40px only from md up, for pointer toolbars.
 */
export const storeButtonSizes = {
  hero: "min-h-14 px-7 py-3.5 text-base leading-6",
  lg: "min-h-12 px-5 py-3 text-base leading-6",
  md: "min-h-11 px-4 py-2.5",
  compact: "min-h-11 px-3 py-2 md:min-h-10",
  icon: "size-11 min-h-11 p-0",
} as const;

export const storeButtonIntents = {
  primary: "border-primary bg-primary font-semibold text-primary-foreground hover:border-brand-strong hover:bg-brand-strong disabled:border-border disabled:bg-border disabled:text-muted-foreground disabled:opacity-100",
  secondary: "border-transparent bg-accent text-accent-foreground hover:bg-[color-mix(in_oklch,var(--accent),var(--accent-foreground)_8%)] hover:text-accent-foreground",
  outline: "border-control-border bg-white text-foreground hover:bg-muted hover:text-foreground",
  ghost: "border-transparent bg-transparent text-foreground hover:bg-muted hover:text-foreground",
  link: "border-transparent bg-transparent text-primary underline-offset-4 hover:bg-transparent hover:underline",
  danger: "border-transparent bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive",
} as const;

const variants = cva(
  "h-auto gap-2 rounded-lg text-sm leading-5 font-medium focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
  { variants: { intent: storeButtonIntents, size: storeButtonSizes }, defaultVariants: { intent: "primary", size: "md" } },
);

export type StoreButtonOptions = VariantProps<typeof variants>;

/** The merged class list (later classes win), so it also works on a plain element without ui/button. */
export function storeButton(options: StoreButtonOptions = {}) {
  return cn(variants(options));
}
