"use client";

import { useState } from "react";
import { lazyModule } from "@/lib/lazy-module";
import { AccountTriggerLabel, accountTriggerClass, type HeaderAccount } from "./account-trigger";

// The popover and the sign-in dialog (Base UI popover + dialog) come on the first hover, focus or click (#1017).
const accountPanel = lazyModule(() => import("./account-panel"));

/**
 * The header's "Hesabım": a plain button that looks like the loaded trigger until the panel's code arrives. A click while
 * it loads opens the panel as soon as it is here; a failed download leaves the button usable, and the next click retries.
 */
export function AccountMenu({ account, accountEmail }: { account: HeaderAccount; accountEmail: boolean }) {
  const panel = accountPanel.useModule();
  const [pending, setPending] = useState<{ phoneOffset: number } | null>(null);
  const [focused, setFocused] = useState(false);
  // Swapping the button between pointerdown and click would lose the click: wait until the press ends.
  const [pressed, setPressed] = useState(false);

  if (panel && !pressed) return <panel.AccountPanel account={account} accountEmail={accountEmail} defaultOpen={pending !== null} initialPhoneOffset={pending?.phoneOffset ?? 0} restoreFocus={focused} />;

  return <div className="relative max-w-[206px] min-w-0">
    <button type="button" aria-label="Hesabım" aria-haspopup="dialog" aria-expanded={false} aria-busy={pending ? true : undefined} className={accountTriggerClass}
      onPointerEnter={accountPanel.preload}
      onFocus={() => { setFocused(true); void accountPanel.preload(); }}
      onBlur={() => setFocused(false)}
      onPointerDown={() => setPressed(true)}
      // Touch fires pointerleave right after pointerup, before click: only a mouse leaving ends the press there.
      onPointerLeave={event => { if (event.pointerType === "mouse") setPressed(false); }}
      onPointerCancel={() => setPressed(false)}
      onClick={event => {
        setPressed(false);
        // On phones the panel spans the screen with a 15px gutter, whatever the trigger's position.
        setPending({ phoneOffset: 15 - event.currentTarget.getBoundingClientRect().left });
        accountPanel.preload().catch(() => setPending(null));
      }}>
      <AccountTriggerLabel account={account} />
    </button>
  </div>;
}
