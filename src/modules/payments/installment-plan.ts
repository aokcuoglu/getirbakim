/**
 * Payment options with an installment fee (#886). Pure: shared by checkout, the product page, the admin preview
 * and the order. Rates are basis points of the TAMI merchant commission (2.85% → 285).
 */
export type InstallmentSettings = {
  enabled: boolean;
  max: number;
  minBasketKurus: number;
  singleRateBp: number;
  ratesBp: Record<number, number>;
};
export type InstallmentOption = { count: number; feeKurus: number; totalKurus: number; monthlyKurus: number };

export const INSTALLMENT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const INSTALLMENT_CARDS_NOTE = "Bonus, World, Maximum, Axess, Paraf, CardFinans, Bankkart, Advantage kredi kartlarında geçerlidir; banka kartında tek çekim.";

/** An installment option the customer pays no fee for ("vade farksız", #1462): the merchant carries the commission. */
export function isNoFeeInstallment(option: Pick<InstallmentOption, "count" | "feeKurus">) {
  return option.count > 1 && option.feeKurus === 0;
}

export const NO_FEE_LABEL = "vade farksız";

export function installmentHint(count: number) {
  return `TAMI ödeme sayfasında ${count} taksit seçin`;
}

/**
 * Customer total so the merchant nets what a single payment would: cash × (1 − single) / (1 − rate), rounded half up
 * to the kuruş in integer arithmetic. Never below the cash price (a rate under the single rate charges no fee).
 */
export function installmentTotal(cashKurus: number, singleRateBp: number, rateBp: number) {
  const d = 10000 - rateBp;
  const total = Math.floor((cashKurus * (10000 - singleRateBp) * 2 + d) / (2 * d));
  return Math.max(total, cashKurus);
}

/**
 * Single payment first, then every count from 2 to `max` that has a rate, when installments are on and the basket
 * (`basketKurus`, the subtotal without shipping) reaches the minimum. `monthlyKurus` is for display only.
 */
export function installmentOptions(settings: InstallmentSettings, cashKurus: number, basketKurus = cashKurus): InstallmentOption[] {
  const options: InstallmentOption[] = [{ count: 1, feeKurus: 0, totalKurus: cashKurus, monthlyKurus: cashKurus }];
  if (!settings.enabled || cashKurus <= 0 || basketKurus < settings.minBasketKurus) return options;
  for (const count of INSTALLMENT_COUNTS) {
    if (count > settings.max) break;
    const rate = settings.ratesBp[count];
    if (rate === undefined) continue;
    const totalKurus = installmentTotal(cashKurus, settings.singleRateBp, rate);
    options.push({ count, feeKurus: totalKurus - cashKurus, totalKurus, monthlyKurus: Math.round(totalKurus / count) });
  }
  return options;
}

/** Everything that changes an installment total; part of the checkout quote so a settings change refuses a stale form. */
export function installmentFingerprint(settings: InstallmentSettings) {
  return [settings.max, settings.minBasketKurus, settings.singleRateBp, INSTALLMENT_COUNTS.map(count => settings.ratesBp[count] ?? null)];
}
