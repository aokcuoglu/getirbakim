"use client";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

/**
 * The storefront filter checkbox: ui/checkbox's look with the store colours, styled by one `.store-check` class
 * (storefront.css) instead of ~900 characters of utilities on each of the ~90 options per listing (#642).
 */
export function StoreCheckbox(props: Omit<CheckboxPrimitive.Root.Props, "className">) {
 return <CheckboxPrimitive.Root data-slot="checkbox" className="store-check" {...props}>
  <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="store-check-indicator"><CheckIcon/></CheckboxPrimitive.Indicator>
 </CheckboxPrimitive.Root>;
}
