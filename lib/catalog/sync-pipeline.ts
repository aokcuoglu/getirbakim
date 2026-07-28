import {
  matchDinamikSupplierRows,
  matchBasbugSupplierRows,
  countUnlinkedSupplierRows,
  type UnlinkedSupplierRows
} from './match-supplier-rows'
import { refreshDinamikOffers, refreshBasbugOffers } from './sync-offers'
import { ingestDinamikOems, ingestBasbugOems, ingestSupplierEans } from './ingest-oems'
import { refreshProductRollups, type RollupStats } from './refresh-product-rollups'

export interface CatalogSyncPipelineResult {
  dinamik: {
    productsCreated: number
    offersLinked: number
    offersUpdated: number
    oemsIngested: number
  }
  basbug: {
    productsCreated: number
    offersLinked: number
    offersLinkedByOem: number
    namesUpgraded: number
    offersUpdated: number
    oemsIngested: number
  }
  eansIngested: number
  rollups: RollupStats
  unlinked: UnlinkedSupplierRows
}

/**
 * Catalog sync steps 2–5 of the pipeline (raw ingest is step 1, owned by the
 * existing supplier sync jobs):
 *   match raw rows → products/offers, refresh offer price/stock,
 *   ingest OEM/EAN codes, refresh product rollups.
 *
 * Every step is set-based and idempotent — safe to run after each supplier
 * sync or on a cron. Dinamik runs before Başbuğ so the Başbuğ OEM-overlap
 * match ladder can see Dinamik-sourced OEM codes on first run.
 */
export async function runCatalogSyncPipeline(options?: {
  onProgress?: (message: string) => void
}): Promise<CatalogSyncPipelineResult> {
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const dnmkMatch = await matchDinamikSupplierRows()
  log(
    `[catalog-sync] dinamik match: +${dnmkMatch.productsCreated} products, +${dnmkMatch.offersLinked} offers`
  )

  const dnmkOffers = await refreshDinamikOffers()
  log(
    `[catalog-sync] dinamik offers: ${dnmkOffers.updated} updated, ${dnmkOffers.deactivated} inactive`
  )

  const dnmkOems = await ingestDinamikOems()
  log(`[catalog-sync] dinamik OEMs: +${dnmkOems}`)

  const bsbgMatch = await matchBasbugSupplierRows()
  log(
    `[catalog-sync] basbug match: +${bsbgMatch.productsCreated} products, +${bsbgMatch.offersLinked} offers by key, +${bsbgMatch.offersLinkedByOem} by OEM, ${bsbgMatch.namesUpgraded} names upgraded, ${bsbgMatch.pendingCandidates} ambiguous → review`
  )

  const bsbgOffers = await refreshBasbugOffers()
  log(
    `[catalog-sync] basbug offers: ${bsbgOffers.updated} updated, ${bsbgOffers.deactivated} inactive`
  )

  const bsbgOems = await ingestBasbugOems()
  log(`[catalog-sync] basbug OEMs: +${bsbgOems}`)

  const eansIngested = await ingestSupplierEans()
  log(`[catalog-sync] EANs: +${eansIngested}`)

  const rollups = await refreshProductRollups()
  log(
    `[catalog-sync] rollups: ${rollups.rollupsUpdated} products updated, ${rollups.slugsFilled} slugs filled`
  )

  const unlinked = await countUnlinkedSupplierRows()
  if (unlinked.dinamik > 0 || unlinked.basbug > 0) {
    log(
      `[catalog-sync] unlinked raw rows (no usable code / ambiguous): dinamik=${unlinked.dinamik}, basbug=${unlinked.basbug}`
    )
  }

  return {
    dinamik: {
      productsCreated: dnmkMatch.productsCreated,
      offersLinked: dnmkMatch.offersLinked,
      offersUpdated: dnmkOffers.updated,
      oemsIngested: dnmkOems
    },
    basbug: {
      productsCreated: bsbgMatch.productsCreated,
      offersLinked: bsbgMatch.offersLinked,
      offersLinkedByOem: bsbgMatch.offersLinkedByOem,
      namesUpgraded: bsbgMatch.namesUpgraded,
      offersUpdated: bsbgOffers.updated,
      oemsIngested: bsbgOems
    },
    eansIngested,
    rollups,
    unlinked
  }
}
