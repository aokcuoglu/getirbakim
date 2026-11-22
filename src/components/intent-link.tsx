"use client";
import { useState, type ComponentProps } from "react";
import Link from "next/link";

/** A normal Link that prefetches only once the user shows intent (pointer enter, touch start or focus). */
export function IntentLink({ onPointerEnter, onTouchStart, onFocus, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [armed, setArmed] = useState(false);
  return <Link
    {...props}
    prefetch={armed ? null : false}
    onPointerEnter={event => { setArmed(true); onPointerEnter?.(event); }}
    onTouchStart={event => { setArmed(true); onTouchStart?.(event); }}
    onFocus={event => { setArmed(true); onFocus?.(event); }}
  />;
}
