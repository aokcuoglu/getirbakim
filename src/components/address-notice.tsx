"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Alert } from "@/components/ui/alert";

const DismissContext = createContext<() => void>(() => {});

/** Starts hiding the page's success notice; the address form calls it when a new submit begins (#999). */
export const useDismissNotice = () => useContext(DismissContext);

/**
 * The /hesap/adresler success notice and the page under it. `noticeId` is new for every render of the page; once a form
 * submits, the notice of that id is hidden, so a stale "Adres kaydedildi." never stays next to a refusal. The next render
 * has a new id and shows its own notice again.
 */
export function AddressNoticeScope({ notice, noticeId, children }: { notice: string | null; noticeId: string; children: ReactNode }) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  return <DismissContext.Provider value={() => setDismissedId(noticeId)}>
    <div role="status" className="mx-auto max-w-[1120px]">{notice && dismissedId !== noticeId && <Alert className="mb-6 flex items-center gap-2 rounded-md border-0 bg-[#ebf5ed] p-[13px] text-sm leading-5 text-[#397247]"><Check className="size-[18px] shrink-0" aria-hidden/> {notice}</Alert>}</div>
    {children}
  </DismissContext.Provider>;
}
