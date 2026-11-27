import { z } from 'zod';
import { INSTALLMENT_COUNTS } from '@/modules/payments/installment-plan';

// A decimal form field; an empty one is refused instead of being coerced to 0.
const decimal=(max:number)=>z.string().trim().min(1).transform(Number).pipe(z.number().min(0).max(max).multipleOf(0.01));
const percent=decimal(50);

/** Form fields of the installment settings card (#886). A rate below the single-payment rate is allowed: it means no fee (#1462). */
export const installmentInput=z.object({
 enabled:z.literal('on').optional(),max:z.coerce.number().int().min(2).max(12),minBasket:decimal(10000000),singleRate:percent,
 ...Object.fromEntries(INSTALLMENT_COUNTS.map(count=>[`rate_${count}`,percent])) as Record<`rate_${(typeof INSTALLMENT_COUNTS)[number]}`,typeof percent>,
});
