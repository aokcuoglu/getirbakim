import { StoreIcon } from "@/components/site/store-icon";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { INSTALLMENT_CARDS_NOTE, type InstallmentOption } from "@/modules/payments/installment-plan";
import { money } from "@/modules/store/money";

/**
 * Product detail "Ödeme seçenekleri" (#886): the single payment and every installment option for this item's price.
 * Checkout recomputes them for the whole basket with shipping, so these are indicative.
 */
export function PaymentOptions({ options }: { options: InstallmentOption[] }) {
  const longest = options.at(-1)!;
  return <Accordion id="odeme-secenekleri" className="border-b border-[#dbe0e6]">
    <AccordionItem value="odeme-secenekleri">
      <AccordionTrigger className="items-center gap-4 rounded-none py-[18px] hover:no-underline">
        <StoreIcon name="credit-card" size={32} className="shrink-0"/>
        <span className="min-w-0"><strong className="block text-base font-medium">Ödeme seçenekleri</strong>
          <small className="mt-1 block text-[13px] font-normal text-[#53677d]">Tek çekim veya {longest.count} taksite kadar · aylık {money(longest.monthlyKurus)}</small></span>
      </AccordionTrigger>
      <AccordionContent className="pb-[18px]">
        <ul className="m-0 grid list-none p-0 text-sm leading-5">
          {options.map(option => <li key={option.count} className="flex items-baseline justify-between gap-3 border-b border-[#e5e7eb] py-2 last:border-b-0">
            <span className="min-w-0">{option.count === 1 ? "Tek çekim" : `${option.count} taksit`}
              {option.count > 1 && <small className="block text-xs text-[#53677d] tabular-nums">{option.count} × {money(option.monthlyKurus)}</small>}</span>
            <strong className="shrink-0 font-medium tabular-nums">{money(option.totalKurus)}</strong>
          </li>)}
        </ul>
        <p className="mt-3 mb-1 text-xs leading-[18px] text-[#53677d]">{INSTALLMENT_CARDS_NOTE}</p>
        <p className="m-0 text-xs leading-[18px] text-[#53677d]">Sepet toplamına ve kargoya göre siparişte kesinleşir.</p>
      </AccordionContent>
    </AccordionItem>
  </Accordion>;
}
