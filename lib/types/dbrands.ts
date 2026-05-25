export type DbrandsAudit = {
  dbrandsTotal: number
  manufacturerTotal: number
  dproductsBrandTotal: number
  dbrandsMatchingManufacturer: number
  manufacturerOnlyInDbrands: number
  dproductsMissingInDbrands: number
  sampleManufacturerOnly: string[]
}

export type DbrandsReconcileResult = {
  dryRun: boolean
  removedManufacturerOnly: number
  insertedFromDproducts: number
  insertedFromApi: number
  dbrandsTotalAfter: number
  audit: DbrandsAudit
}

export type DbrandsMatchAudit = {
  matchTotal: number
  dbrandsTotal: number
  manufacturerTotal: number
  withDinamikBrand: number
  withManufacturer: number
  ptOnlyRows: number
  dinamikStubRows: number
  pairedRows: number
  manufacturersMissingFromMatch: number
  dbrandsMissingFromMatch: number
}

export type DbrandsMatchSeedResult = {
  dryRun: boolean
  removedRedundantStubs: number
  insertedDinamikStubs: number
  insertedPtOnly: number
  insertedAutoMatched: number
  matchTotalAfter: number
}
