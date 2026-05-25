export type DproductsBrandSyncSummary = {
  brand: string
  fetched: number
  upserted: number
  markedPassive: number
  failed: boolean
  error?: string
}

export type DproductsStockSyncResult = {
  dryRun: boolean
  brandsTotal: number
  brandsProcessed: number
  fetchedTotal: number
  upsertedTotal: number
  markedPassiveTotal: number
  failedBrands: number
  brands: DproductsBrandSyncSummary[]
  errors: string[]
}
