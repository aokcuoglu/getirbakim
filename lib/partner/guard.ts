import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, withApiContext } from '@/lib/api/route-utils'
import { resolveScopedPartner, PARTNER_KEYS_ENV, PARTNER_ORDER_KEYS_ENV, type PartnerIdentity } from './auth'

type ApiContext = ReturnType<typeof withApiContext>['context']

export interface PartnerGuardPass {
  partner: PartnerIdentity
  context: ApiContext
}

/**
 * `app/api/partner/v1/*` ortak kapısı: hız sınırı → kimlik doğrulama.
 *
 * SIRA ÖNEMLİ: hız sınırı kimlik doğrulamadan ÖNCE gelir, çünkü anahtar deneyen
 * bir istemci de sınıra takılmalı — sonra sıralasaydık kaba kuvvet denemeleri
 * sınırsız olurdu.
 *
 * Yetkisiz cevap her zaman 401 ve GEREKÇESİZDİR: "anahtar yok" ile "anahtar
 * yanlış"ı ayırmak, geçerli bir anahtar biçimini arayana bilgi verir.
 */
export function partnerGuard(
  request: NextRequest,
  keyPrefix: string,
  scope: 'catalog' | 'orders' = 'catalog'
): NextResponse | PartnerGuardPass {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix,
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const partner = resolveScopedPartner(
    request.headers.get('authorization'),
    scope,
    process.env[PARTNER_KEYS_ENV],
    process.env[PARTNER_ORDER_KEYS_ENV]
  )
  if (!partner) {
    return errorResponse({
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Valid partner API key required.',
      context
    })
  }

  return { partner, context }
}
