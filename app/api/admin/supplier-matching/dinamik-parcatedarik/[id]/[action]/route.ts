import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { resolveParcatedarikToParts } from '@/lib/matching/parcatedarik-to-parts-resolver'
import { applyPolicyForPart } from '@/lib/suppliers/sync-dinamik'

async function getMatchId(request: NextRequest): Promise<bigint | null> {
  const url = new URL(request.url)
  const parts = url.pathname.split('/')
  const idStr = parts[parts.length - 2]
  if (!idStr) return null
  try {
    return BigInt(idStr)
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin:dpmm:action',
    limit: 60,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const auth = await getAdminAuth()
  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  const pathParts = new URL(request.url).pathname.split('/')
  const actionStr = pathParts[pathParts.length - 1]
  const idStr = pathParts[pathParts.length - 2]
  if (!idStr || !actionStr) {
    return errorResponse({ status: 400, code: 'INVALID_REQUEST', message: 'Missing match ID or action.', context })
  }

  let matchId: bigint
  try {
    matchId = BigInt(idStr)
  } catch {
    return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Invalid match ID.', context })
  }

  const validActions = ['approve', 'reject', 'ignore', 'needs-review'] as const
  type MatchAction = (typeof validActions)[number]
  const action: MatchAction | undefined = validActions.find((a) => a === actionStr) as MatchAction | undefined
  if (!action) {
    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Invalid action: ${actionStr}`, context })
  }

  try {
    const match = await db.$queryRaw<
      Array<{
        id: bigint
        dinamik_product_id: bigint
        parcatedarik_product_id: number
        status: string
        match_reason: string
        confidence: number
      }>
    >(Prisma.sql`
      SELECT id, dinamik_product_id, parcatedarik_product_id, status, match_reason, confidence
      FROM public.dinamik_parcatedarik_model_matches
      WHERE id = ${matchId}
    `)

    if (!match || match.length === 0) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Match not found.', context })
    }

    const matchRow = match[0]
    const adminUser = auth.user.email || auth.user.id

    if (action === 'approve') {
      const ptProduct = await db.$queryRaw<
        Array<{ id: number; ref_no: string | null }>
      >(Prisma.sql`
        SELECT id, ref_no FROM parcatedarik.product WHERE id = ${matchRow.parcatedarik_product_id}
      `)

      const refNo = ptProduct.length > 0 ? ptProduct[0].ref_no : null

      let partCandidates: Awaited<ReturnType<typeof resolveParcatedarikToParts>> | null = null
      if (refNo) {
        partCandidates = await resolveParcatedarikToParts(matchRow.parcatedarik_product_id, refNo)
      }

      await db.$executeRaw(Prisma.sql`
        UPDATE public.dinamik_parcatedarik_model_matches
        SET status = 'APPROVED',
            approved_by = ${adminUser},
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = ${matchId}
      `)

      if (partCandidates && partCandidates.candidates.length === 1 && !partCandidates.ambiguous) {
        const candidate = partCandidates.candidates[0]
        const dinamikProvider = await db.supplier_providers.findFirst({
          where: { code: { contains: 'dinamik', mode: 'insensitive' } }
        })

        if (dinamikProvider) {
          const dinamikProduct = await db.$queryRaw<
            Array<{ id: bigint; stock_code: string; price: string | null }>
          >(Prisma.sql`
            SELECT id, stock_code, price FROM dinamik.products WHERE id = ${matchRow.dinamik_product_id}
          `)

          if (dinamikProduct.length > 0) {
            const dp = dinamikProduct[0]
            const supplierProduct = await db.supplier_products.findFirst({
              where: {
                provider_id: dinamikProvider.id,
                supplier_sku: dp.stock_code
              }
            })

            if (!supplierProduct) {
              return successResponse({
                id: matchId.toString(),
                action: 'approved',
                partCandidates: partCandidates.candidates.length,
                refNo,
                warning: 'No supplier_products row found for this Dinamik product. Mapping and offer were not created. Run Dinamik sync first.'
              }, context)
            }

            const matchReason = `DINAMIK_BARCODE_PARCA_MODEL_TO_PART:${candidate.matchType}`

            const offerPrice = supplierProduct.supplier_price ?? (dp.price ? new Prisma.Decimal(dp.price) : null)
            const offerStockQty = supplierProduct.supplier_stock_qty ?? 0
            const offerCurrency = supplierProduct.currency || 'TRY'

            await db.supplier_part_mappings.upsert({
              where: {
                provider_id_supplier_product_id: {
                  provider_id: dinamikProvider.id,
                  supplier_product_id: supplierProduct.id
                }
              },
              create: {
                provider_id: dinamikProvider.id,
                supplier_product_id: supplierProduct.id,
                supplier_sku: dp.stock_code,
                part_id: candidate.partId,
                status: 'CANDIDATE',
                workflow_status: 'NEW',
                confidence: new Prisma.Decimal(candidate.confidence),
                match_reason: matchReason,
                is_manual: false
              },
              update: {
                part_id: candidate.partId,
                confidence: new Prisma.Decimal(candidate.confidence),
                match_reason: matchReason,
                updated_at: new Date()
              }
            })

            await db.part_supplier_offers.upsert({
              where: {
                provider_id_supplier_product_id: {
                  provider_id: dinamikProvider.id,
                  supplier_product_id: supplierProduct.id
                }
              },
              create: {
                provider_id: dinamikProvider.id,
                supplier_product_id: supplierProduct.id,
                part_id: candidate.partId,
                supplier_price: offerPrice,
                supplier_stock_qty: offerStockQty,
                currency: offerCurrency,
                is_active: true
              },
              update: {
                part_id: candidate.partId,
                supplier_price: offerPrice,
                supplier_stock_qty: offerStockQty,
                currency: offerCurrency,
                is_active: true,
                updated_at: new Date()
              }
            })

            try {
              await applyPolicyForPart(candidate.partId)
            } catch (policyError) {
              console.error(`Error applying pricing policy for part ${candidate.partId}:`, policyError)
            }
          }
        }
      } else if (partCandidates && (partCandidates.candidates.length > 1 || partCandidates.ambiguous)) {
        await db.$executeRaw(Prisma.sql`
          UPDATE public.dinamik_parcatedarik_model_matches
          SET status = 'NEEDS_REVIEW',
              review_note = 'Multiple public.parts candidates found - manual resolution required',
              updated_at = NOW()
          WHERE id = ${matchId}
        `)

        return successResponse({
          id: matchId.toString(),
          action: 'needs_review',
          reason: 'Multiple part candidates - needs manual resolution',
          partCandidates: partCandidates.candidates.length,
          refNo
        }, context)
      }

      return successResponse({
        id: matchId.toString(),
        action: 'approved',
        partCandidates: partCandidates?.candidates.length ?? 0,
        refNo
      }, context)
    }

    if (action === 'reject') {
      await db.$executeRaw(Prisma.sql`
        UPDATE public.dinamik_parcatedarik_model_matches
        SET status = 'REJECTED',
            rejected_by = ${adminUser},
            rejected_at = NOW(),
            updated_at = NOW()
        WHERE id = ${matchId}
      `)
      return successResponse({ id: matchId.toString(), action: 'rejected' }, context)
    }

    if (action === 'ignore') {
      await db.$executeRaw(Prisma.sql`
        UPDATE public.dinamik_parcatedarik_model_matches
        SET status = 'IGNORED',
            updated_at = NOW()
        WHERE id = ${matchId}
      `)
      return successResponse({ id: matchId.toString(), action: 'ignored' }, context)
    }

    if (action === 'needs-review') {
      const body = await request.json().catch(() => ({}))
      const reviewNote = body.reviewNote || null
      await db.$executeRaw(Prisma.sql`
        UPDATE public.dinamik_parcatedarik_model_matches
        SET status = 'NEEDS_REVIEW',
            review_note = ${reviewNote},
            updated_at = NOW()
        WHERE id = ${matchId}
      `)
      return successResponse({ id: matchId.toString(), action: 'needs_review' }, context)
    }

    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: 'Unhandled action.', context })
  } catch (error) {
    console.error(`Error in match action ${action}:`, error)
    return errorResponse({ status: 500, code: 'ACTION_FAILED', message: `Failed to ${action} match.`, context })
  }
}