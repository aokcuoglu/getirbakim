import Link from "next/link";
import { StoreIcon } from "@/components/site/store-icon";
import { cn } from "@/lib/utils";

export const checkoutStepsClass = "m-0 flex list-none items-center gap-6 p-0 text-[13px] leading-5 max-[760px]:gap-3 max-[760px]:text-xs max-[380px]:gap-2";
// Same separators for the page and its skeleton, so the header does not shift when it loads.
export const checkoutStepClass = "flex items-center gap-2 whitespace-nowrap not-last:after:ml-1 not-last:after:h-px not-last:after:w-[30px] not-last:after:bg-[#dfe3e8] not-last:after:content-[''] max-[760px]:not-last:after:w-4 max-[380px]:gap-1.5 max-[380px]:not-last:after:hidden";
const stepMark = "grid size-8 place-items-center rounded-full border border-input max-[380px]:size-6";

export function CheckoutSteps() {
  return <ol className={checkoutStepsClass}>
    <li className={checkoutStepClass}><Link href="/sepet" className="flex items-center gap-2 hover:text-primary max-[760px]:min-h-11 max-[380px]:gap-1.5"><span className={cn(stepMark,"border-[#73a985] bg-[#f1f8f3] text-[#168657]")}><StoreIcon name="check" className="size-4"/></span>Sepet<span className="sr-only"> (tamamlandı)</span></Link></li>
    <li className={checkoutStepClass} aria-current="step"><span className={cn(stepMark,"border-primary text-primary")}>1</span>Teslimat</li>
    <li className={checkoutStepClass}><span className={stepMark}>2</span>Ödeme</li>
  </ol>;
}
