export type DbrandsAudit = {
  dnbrdTotal: number
  manufacturerTotal: number
  dnprdBrandTotal: number
  dnbrdMatchingManufacturer: number
  manufacturerOnlyInDbrands: number
  dnprdMissingInDbrands: number
  sampleManufacturerOnly: string[]
}

export type DbrandsReconcileResult = {
  dryRun: boolean
  removedManufacturerOnly: number
  insertedFromDproducts: number
  insertedFromApi: number
  dnbrdTotalAfter: number
  audit: DbrandsAudit
}

export type DbrandsMatchAudit = {
  matchTotal: number
  dnbrdTotal: number
  manufacturerTotal: number
  withDinamikBrand: number
  withManufacturer: number
  ptOnlyRows: number
  dinamikStubRows: number
  pairedRows: number
  manufacturersMissingFromMatch: number
  dnbrdMissingFromMatch: number
}

export type DbrandsMatchSeedResult = {
  dryRun: boolean
  removedRedundantStubs: number
  removedRedundantPtOnly: number
  insertedDinamikStubs: number
  insertedPtOnly: number
  insertedAutoMatched: number
  matchTotalAfter: number
}
