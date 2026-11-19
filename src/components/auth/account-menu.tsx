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
export function AccountMenu({ account }: { account: HeaderAccount }) {
  const panel = accountPanel.use();
  const [pending, setPending] = useState<{ phoneOffset: number } | null>(null);
  const [focused, setFocused] = useState(false);

  if (panel) return <panel.AccountPanel account={account} defaultOpen={pending !== null} initialPhoneOffset={pending?.phoneOffset ?? 0} restoreFocus={focused} />;

  return <div className="relative max-w-[206px] min-w-0">
    <button type="button" aria-label="Hesabım" aria-haspopup="dialog" aria-expanded={false} aria-busy={pending ? true : undefined} className={accountTriggerClass}
      onPointerEnter={accountPanel.preload}
      onFocus={() => { setFocused(true); void accountPanel.preload(); }}
      onBlur={() => setFocused(false)}
      onClick={event => {
        // On phones the panel spans the screen with a 15px gutter, whatever the trigger's position.
        setPending({ phoneOffset: 15 - event.currentTarget.getBoundingClientRect().left });
        accountPanel.preload().catch(() => setPending(null));
      }}>
      <AccountTriggerLabel account={account} />
    </button>
  </div>;
}
