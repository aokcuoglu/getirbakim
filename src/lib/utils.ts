import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The storefront button classes (`store-btn`, `store-btn-<intent>`, `store-btn-<size>`; src/components/store-button.ts,
 * #1134) are named CSS classes in the components layer, so they lose to the utilities ui/button carries. Declaring what
 * each one replaces lets twMerge drop those ui/button utilities, the way the old utility list overrode them.
 */
const twMerge = extendTailwindMerge<"store-btn" | "store-btn-intent" | "store-btn-size">({
  extend: {
    classGroups: {
      "store-btn": ["store-btn"],
      "store-btn-intent": ["store-btn-primary", "store-btn-secondary", "store-btn-outline", "store-btn-ghost", "store-btn-link", "store-btn-danger"],
      "store-btn-size": ["store-btn-hero", "store-btn-lg", "store-btn-md", "store-btn-compact", "store-btn-icon"],
    },
    conflictingClassGroups: {
      "store-btn": ["h", "gap", "rounded", "font-size", "font-weight", "outline-style", "leading"],
      "store-btn-intent": ["border-color", "bg-color", "text-color", "font-weight"],
      "store-btn-size": ["px", "py", "p", "min-h", "size", "font-size", "leading"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
