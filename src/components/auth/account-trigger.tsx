import { SiteIcon } from "@/components/site/site-icon";
import { headerToolClass } from "@/components/navigation/header-tool";
import { cn } from "@/lib/utils";

export type HeaderAccount = { name: string; role: string } | null;

/** The header's "Hesabım" button look, shared by the light shell (account-menu.tsx) and the loaded panel's trigger. */
export const accountTriggerClass = cn("header-tool-wide", headerToolClass);

export function AccountTriggerLabel({ account }: { account: HeaderAccount }) {
  return <>
    <SiteIcon name="profile" size={32} />
    <span className="max-w-[164px] min-w-0">
      <strong className="max-w-none! whitespace-nowrap"><span className="min-w-0 truncate" title={account?.name}>{account ? account.name : "Hesabım"}</span><SiteIcon name="chevron" size={13} /></strong>
      <small>{account ? "B2B hesabı" : "Giriş yap"}</small>
    </span>
  </>;
}
