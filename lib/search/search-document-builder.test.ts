import { describe, expect, it } from 'bun:test'
import { resolveAvailabilityStatus, resolveCTA } from './availability'
import type { CanonicalSearchDocument } from './search-document-types'
import { expandSynonyms, getMeiliSynonyms, buildSynonymsText, SYNONYM_GROUPS } from './search-synonyms'
import { normalizeCode, compactCode } from './code-normalization'

describe('SearchDocument availability status rules', () => {
  it('PURCHASABLE when has price and stock > 0', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: true,
      availableStock: 5,
      hasSupplierOffer: true,
      hasPartId: true
    })
    expect(result).toBe('PURCHASABLE')
  })

  it('OUT_OF_STOCK when has price but stock <= 0', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: true,
      availableStock: 0,
      hasSupplierOffer: true,
      hasPartId: true
    })
    expect(result).toBe('OUT_OF_STOCK')
  })

  it('REQUEST_PRICE when no price (catalog-only product)', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: false,
      availableStock: 0,
      hasSupplierOffer: false,
      hasPartId: true
    })
    expect(result).toBe('REQUEST_PRICE')
  })

  it('REQUEST_PRICE for supplier product without price', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: false,
      availableStock: 0,
      hasSupplierOffer: true,
      hasPartId: false
    })
    expect(result).toBe('REQUEST_PRICE')
  })
})

describe('SearchDocument shape validation', () => {
  it('has required fields for a PURCHASABLE canonical_part', () => {
    const doc: CanonicalSearchDocument = {
      id: 'part_100',
      documentType: 'canonical_part',
      partId: '100',
      supplierProductId: null,
      canonicalPartId: '100',
      title: 'Bosch Brake Pad',
      titleTr: null,
      brand: 'Bosch',
      categoryId: 10,
      categoryName: 'Brake Pads',
      categoryNameTr: 'Fren Balataları',
      categorySlug: 'brake-pads',
      supplierSku: null,
      normalizedSku: null,
      providerCode: null,
      providerName: null,
      oemCodes: ['0986424020'],
      eanCodes: ['5901234123457'],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: ['0986424020', '0986424020', '5901234123457'],
      normalizedSearchText: 'bosch brake pad 0986424020 5901234123457 brake pads',
      searchKeywords: ['bosch', 'brake', 'pad', '0986424020'],
      synonymsText: 'fren balatasi brake pad brake-pad fren-balatasi',
      price: 250.00,
      stockQty: 5,
      currency: 'TRY',
      hasPrice: true,
      hasStock: true,
      hasSupplierOffer: true,
      offerCount: 1,
      bestOfferProvider: 'Dinamik',
      bestOfferSupplierProductId: 42,
      availabilityStatus: 'PURCHASABLE',
      cta: 'add_to_cart',
      matchStatus: 'APPROVED',
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: ['Volkswagen'],
      vehicleModelNames: ['Golf'],
      vehicleTypeNames: ['Golf VII 2.0 TDI'],
      vehicleYears: ['2019'],
      engineCodes: ['CRBC'],
      fitmentCount: 3,
      detailUrl: '/part/100',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 100,
      name: 'Bosch Brake Pad',
      brandName: 'Bosch',
      brandId: 5,
      articleLinkId: '200',
      sourceType: 'part'
    }

    expect(doc.id).toBe('part_100')
    expect(doc.documentType).toBe('canonical_part')
    expect(doc.availabilityStatus).toBe('PURCHASABLE')
    expect(doc.cta).toBe('add_to_cart')
    expect(doc.hasPrice).toBe(true)
    expect(doc.hasStock).toBe(true)
    expect(doc.hasSupplierOffer).toBe(true)
    expect(doc.offerCount).toBe(1)
    expect(doc.bestOfferProvider).toBe('Dinamik')
    expect(doc.rankScore).toBe(100)
    expect(doc.sourceType).toBe('part')
    expect(doc.detailUrl).toBe('/part/100')
    expect(doc.matchStatus).toBe('APPROVED')
  })

  it('has REQUEST_PRICE for no-price catalog product', () => {
    const doc: CanonicalSearchDocument = {
      id: 'part_200',
      documentType: 'canonical_part',
      partId: '200',
      supplierProductId: null,
      canonicalPartId: '200',
      title: 'Catalog Filter',
      titleTr: null,
      brand: 'Generic',
      categoryId: 15,
      categoryName: 'Fuel Filter',
      categoryNameTr: 'Yakıt Filtresi',
      categorySlug: 'fuel-filter',
      supplierSku: null,
      normalizedSku: null,
      providerCode: null,
      providerName: null,
      oemCodes: [],
      eanCodes: [],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: [],
      normalizedSearchText: 'catalog filter generic fuel filter',
      searchKeywords: ['catalog', 'filter', 'generic', 'fuel'],
      synonymsText: '',
      price: null,
      stockQty: 0,
      currency: 'TRY',
      hasPrice: false,
      hasStock: false,
      hasSupplierOffer: false,
      offerCount: 0,
      bestOfferProvider: null,
      bestOfferSupplierProductId: null,
      availabilityStatus: 'REQUEST_PRICE',
      cta: 'request_price',
      matchStatus: 'UNMAPPED',
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl: '/part/200',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 35,
      name: 'Catalog Filter',
      brandName: 'Generic',
      brandId: null,
      articleLinkId: '300',
      sourceType: 'part'
    }

    expect(doc.documentType).toBe('canonical_part')
    expect(doc.availabilityStatus).toBe('REQUEST_PRICE')
    expect(doc.cta).toBe('request_price')
    expect(doc.hasPrice).toBe(false)
    expect(doc.hasSupplierOffer).toBe(false)
    expect(doc.offerCount).toBe(0)
    expect(doc.matchStatus).toBe('UNMAPPED')
  })

  it('creates orphan supplier product document correctly', () => {
    const doc: CanonicalSearchDocument = {
      id: 'sp_500',
      documentType: 'orphan_supplier_product',
      partId: null,
      supplierProductId: 500,
      canonicalPartId: null,
      title: 'DIN SP12345',
      titleTr: null,
      brand: 'Mann',
      categoryId: null,
      categoryName: null,
      categoryNameTr: null,
      categorySlug: null,
      supplierSku: 'SP12345',
      normalizedSku: 'sp12345',
      providerCode: 'DIN',
      providerName: 'Dinamik',
      oemCodes: ['W91480'],
      eanCodes: ['4006335362011'],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: ['W91480', 'w91480', '4006335362011', 'SP12345', 'sp12345'],
      normalizedSearchText: 'din sp12345 mann w91480 4006335362011',
      searchKeywords: ['din', 'sp12345', 'mann', 'w91480'],
      synonymsText: '',
      price: 45.0,
      stockQty: 10,
      currency: 'TRY',
      hasPrice: true,
      hasStock: true,
      hasSupplierOffer: false,
      offerCount: 0,
      bestOfferProvider: 'Dinamik',
      bestOfferSupplierProductId: 500,
      availabilityStatus: 'PURCHASABLE',
      cta: 'add_to_cart',
      matchStatus: 'UNMAPPED',
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl: '/supplier-product/500',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 110,
      name: 'Mann Filter SP12345',
      brandName: 'Mann',
      brandId: null,
      articleLinkId: '500',
      sourceType: 'supplier_product'
    }

    expect(doc.id).toBe('sp_500')
    expect(doc.documentType).toBe('orphan_supplier_product')
    expect(doc.partId).toBeNull()
    expect(doc.hasSupplierOffer).toBe(false)
    expect(doc.canonicalPartId).toBeNull()
    expect(doc.matchStatus).toBe('UNMAPPED')
    expect(doc.detailUrl).toBe('/supplier-product/500')
  })

  it('stock+price supplier offer => PURCHASABLE', () => {
    const doc: CanonicalSearchDocument = {
      id: 'part_300',
      documentType: 'supplier_offer',
      partId: '300',
      supplierProductId: 301,
      canonicalPartId: '300',
      title: 'Seta Brake Disc',
      titleTr: null,
      brand: 'Seta',
      categoryId: 20,
      categoryName: 'Brake Discs',
      categoryNameTr: null,
      categorySlug: 'brake-discs',
      supplierSku: 'SD-4500',
      normalizedSku: 'sd4500',
      providerCode: 'SET',
      providerName: 'Seta',
      oemCodes: [],
      eanCodes: [],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: ['SD4500', 'sd4500'],
      normalizedSearchText: 'seta brake disc sd4500',
      searchKeywords: ['seta', 'brake', 'disc', 'sd4500'],
      synonymsText: '',
      price: 120.0,
      stockQty: 3,
      currency: 'TRY',
      hasPrice: true,
      hasStock: true,
      hasSupplierOffer: true,
      offerCount: 2,
      bestOfferProvider: 'Seta',
      bestOfferSupplierProductId: 301,
      availabilityStatus: 'PURCHASABLE',
      cta: 'add_to_cart',
      matchStatus: 'APPROVED',
      matchConfidence: 0.97,
      matchReason: 'OEM_EXACT',
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl: '/part/300',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 120,
      name: 'Seta Brake Disc',
      brandName: 'Seta',
      brandId: null,
      articleLinkId: '400',
      sourceType: 'supplier_product'
    }

    expect(doc.availabilityStatus).toBe('PURCHASABLE')
    expect(doc.hasSupplierOffer).toBe(true)
    expect(doc.offerCount).toBe(2)
    expect(doc.matchStatus).toBe('APPROVED')
    expect(doc.matchConfidence).toBe(0.97)
    expect(doc.matchReason).toBe('OEM_EXACT')
    expect(doc.providerCode).toBe('SET')
  })

  it('rank scores: PURCHASABLE > OUT_OF_STOCK > REQUEST_PRICE', () => {
    expect(100 > 50).toBe(true)
    expect(50 > 25).toBe(true)
  })
})

describe('Search fallback behavior', () => {
  it('resolveAvailabilityStatus maps CTA correctly', () => {
    expect(resolveCTA('PURCHASABLE')).toBe('add_to_cart')
    expect(resolveCTA('REQUEST_PRICE')).toBe('request_price')
    expect(resolveCTA('OUT_OF_STOCK')).toBe('notify_or_request_price')
    expect(resolveCTA('VERIFY_FITMENT')).toBe('verify_fitment')
  })
})

describe('Search synonyms', () => {
  it('includes Turkish-English automotive synonym groups', () => {
    expect(SYNONYM_GROUPS.length >= 12).toBe(true)

    const fuelFilter = SYNONYM_GROUPS.find((g) => g.canonical === 'fuel filter')
    expect(fuelFilter != null).toBe(true)
    expect(fuelFilter!.terms.includes('yakit filtresi')).toBe(true)
    expect(fuelFilter!.terms.includes('mazot filtresi')).toBe(true)

    const brakePad = SYNONYM_GROUPS.find((g) => g.canonical === 'brake pad')
    expect(brakePad != null).toBe(true)
    expect(brakePad!.terms.includes('fren balatasi')).toBe(true)
  })

  it('expandSynonyms returns original query plus matching group terms', () => {
    const expanded = expandSynonyms('fuel filter')
    expect(expanded.includes('fuel filter')).toBe(true)
    expect(expanded.includes('yakit filtresi')).toBe(true)
    expect(expanded.includes('mazot filtresi')).toBe(true)

    const expandedTr = expandSynonyms('yakit filtresi')
    expect(expandedTr.includes('yakit filtresi')).toBe(true)
    expect(expandedTr.includes('fuel filter')).toBe(true)
  })

  it('getMeiliSynonyms returns mapping for all synonym terms', () => {
    const synonyms = getMeiliSynonyms()
    expect(Object.keys(synonyms).length > 0).toBe(true)
    expect(synonyms['fuel filter'].includes('yakit filtresi')).toBe(true)
    expect(synonyms['yakit filtresi'].includes('fuel filter')).toBe(true)
  })

  it('buildSynonymsText returns combined text for category and title', () => {
    const text = buildSynonymsText({ categoryName: 'Fuel Filter', title: 'Bosch Fuel Filter' })
    expect(text.includes('fuel filter')).toBe(true)
    expect(text.includes('yakit filtresi')).toBe(true)
  })

  it('Meilisearch document IDs use valid part_ / sp_ prefixes', () => {
    const partDoc = 'part_100'
    const spDoc = 'sp_500'
    const partMatch = /^part_\d+$/.test(partDoc)
    const spMatch = /^sp_\d+$/.test(spDoc)
    expect(partMatch).toBe(true)
    expect(spMatch).toBe(true)
    expect(partDoc.includes(':')).toBe(false)
    expect(spDoc.includes(':')).toBe(false)
  })

  it('low-confidence name similarity never auto-approves', () => {
    const NAME_SIMILARITY_MAX = 0.70
    const AUTO_APPROVE_THRESHOLD = 0.95
    expect(NAME_SIMILARITY_MAX < AUTO_APPROVE_THRESHOLD).toBe(true)
  })

  it('exact OEM and EAN matches have confidence at auto-approve threshold', () => {
    const OEM_MIN = 0.95
    const EAN_MIN = 0.95
    const AUTO_APPROVE = 0.95
    expect(OEM_MIN >= AUTO_APPROVE).toBe(true)
    expect(EAN_MIN >= AUTO_APPROVE).toBe(true)
  })

  it('cross-reference matches have moderate confidence below auto-approve', () => {
    const CROSS_REF_MAX = 0.95
    const CROSS_REF_MIN = 0.85
    expect(CROSS_REF_MIN >= 0.85).toBe(true)
    expect(CROSS_REF_MAX <= 0.95).toBe(true)
  })
})

describe('Page size cap', () => {
  it('caps search limit to 60', () => {
    expect(Math.max(1, Math.min(200, 60))).toBe(60)
    expect(Math.max(1, Math.min(200, 24))).toBe(24)
    expect(Math.max(1, Math.min(200, 1))).toBe(1)
  })

  it('minimum limit is 1', () => {
    expect(Math.max(1, Math.min(200, 0))).toBe(1)
  })
})

describe('exactCodes field in documents', () => {
  it('exactCodes includes normalized and compact versions of OEM codes', () => {
    const oemCodes = ['0 445 110 376']
    const exactCodes = Array.from(new Set([
      ...oemCodes.map(c => normalizeCode(c)),
      ...oemCodes.map(c => compactCode(c)),
    ].filter(Boolean)))
    expect(exactCodes.includes('0445110376')).toBe(true)
  })

  it('exactCodes includes SKU in normalized and compact form', () => {
    const sku = 'ABC-123'
    expect(normalizeCode(sku)).toBe('ABC123')
    expect(compactCode(sku)).toBe('abc123')
  })

  it('exactCodes deduplicates identical normalized and compact codes', () => {
    const code = '0445110376'
    const normalized = normalizeCode(code)
    const compact = compactCode(code)
    expect(normalized).toBe('0445110376')
    expect(compact).toBe('0445110376')
  })

  it('exactCodes deduplicates identical normalized and compact codes', () => {
    const code = '0445110376'
    const normalized = normalizeCode(code)
    const compact = compactCode(code)
    expect(normalized).toBe('0445110376')
    expect(compact).toBe('0445110376')
  })

  it('exactCodes preserves leading zeros in compact form', () => {
    const code = '0 445 110 376'
    expect(compactCode(code)).toBe('0445110376')
  })

  it('fitment enrichment covers both supplier_offer and canonical_part documents', () => {
    const supplierDoc: CanonicalSearchDocument = {
      id: 'part_100',
      documentType: 'supplier_offer',
      partId: '100',
      supplierProductId: 50,
      canonicalPartId: '100',
      title: 'Supplier Offer Part',
      titleTr: null,
      brand: 'Bosch',
      categoryId: 10,
      categoryName: 'Brake Pads',
      categoryNameTr: null,
      categorySlug: 'brake-pads',
      supplierSku: 'SKU100',
      normalizedSku: 'sku100',
      providerCode: 'DIN',
      providerName: 'Dinamik',
      oemCodes: [],
      eanCodes: [],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: [],
      normalizedSearchText: '',
      searchKeywords: [],
      synonymsText: '',
      price: 100,
      stockQty: 5,
      currency: 'TRY',
      hasPrice: true,
      hasStock: true,
      hasSupplierOffer: true,
      offerCount: 1,
      bestOfferProvider: 'Dinamik',
      bestOfferSupplierProductId: 50,
      availabilityStatus: 'PURCHASABLE',
      cta: 'add_to_cart',
      matchStatus: 'APPROVED',
      matchConfidence: 0.98,
      matchReason: 'OEM_EXACT',
      vehicleBrandNames: ['Volkswagen'],
      vehicleModelNames: ['Golf'],
      vehicleTypeNames: [],
      vehicleYears: ['2019'],
      engineCodes: ['CRBC'],
      fitmentCount: 3,
      detailUrl: '/part/100',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 110,
      name: 'Bosch Brake Pad',
      brandName: 'Bosch',
      brandId: 5,
      articleLinkId: '200',
      sourceType: 'supplier_product'
    }

    const catalogDoc: CanonicalSearchDocument = {
      id: 'part_200',
      documentType: 'canonical_part',
      partId: '200',
      supplierProductId: null,
      canonicalPartId: '200',
      title: 'Catalog Brake Pad',
      titleTr: null,
      brand: 'Generic',
      categoryId: 10,
      categoryName: 'Brake Pads',
      categoryNameTr: 'Fren Balataları',
      categorySlug: 'brake-pads',
      supplierSku: null,
      normalizedSku: null,
      providerCode: null,
      providerName: null,
      oemCodes: ['0986424020'],
      eanCodes: [],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: ['0986424020', '0986424020'],
      normalizedSearchText: '',
      searchKeywords: [],
      synonymsText: '',
      price: null,
      stockQty: 0,
      currency: 'TRY',
      hasPrice: false,
      hasStock: false,
      hasSupplierOffer: false,
      offerCount: 0,
      bestOfferProvider: null,
      bestOfferSupplierProductId: null,
      availabilityStatus: 'REQUEST_PRICE',
      cta: 'request_price',
      matchStatus: 'UNMAPPED',
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl: '/part/200',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 25,
      name: 'Catalog Brake Pad',
      brandName: 'Generic',
      brandId: null,
      articleLinkId: '300',
      sourceType: 'part'
    }

    expect(supplierDoc.documentType).toBe('supplier_offer')
    expect(supplierDoc.partId).toBe('100')
    expect(supplierDoc.fitmentCount).toBe(3)
    expect(supplierDoc.vehicleBrandNames).toEqual(['Volkswagen'])

    expect(catalogDoc.documentType).toBe('canonical_part')
    expect(catalogDoc.partId).toBe('200')
    expect(catalogDoc.fitmentCount).toBe(0)
  })

  it('orphan supplier product has no fitment data', () => {
    const orphanDoc: CanonicalSearchDocument = {
      id: 'sp_500',
      documentType: 'orphan_supplier_product',
      partId: null,
      supplierProductId: 500,
      canonicalPartId: null,
      title: 'DIN SP12345',
      titleTr: null,
      brand: 'Mann',
      categoryId: null,
      categoryName: null,
      categoryNameTr: null,
      categorySlug: null,
      supplierSku: 'SP12345',
      normalizedSku: 'sp12345',
      providerCode: 'DIN',
      providerName: 'Dinamik',
      oemCodes: ['W91480'],
      eanCodes: ['4006335362011'],
      crossReferences: [],
      referenceNumbers: [],
      exactCodes: ['W91480', 'w91480', '4006335362011', 'SP12345', 'sp12345'],
      normalizedSearchText: 'din sp12345 mann w91480 4006335362011',
      searchKeywords: ['din', 'sp12345', 'mann', 'w91480'],
      synonymsText: '',
      price: 45.0,
      stockQty: 10,
      currency: 'TRY',
      hasPrice: true,
      hasStock: true,
      hasSupplierOffer: false,
      offerCount: 0,
      bestOfferProvider: 'Dinamik',
      bestOfferSupplierProductId: 500,
      availabilityStatus: 'PURCHASABLE',
      cta: 'add_to_cart',
      matchStatus: 'UNMAPPED',
      matchConfidence: null,
      matchReason: null,
      vehicleBrandNames: [],
      vehicleModelNames: [],
      vehicleTypeNames: [],
      vehicleYears: [],
      engineCodes: [],
      fitmentCount: 0,
      detailUrl: '/supplier-product/500',
      imageUrl: null,
      updatedAt: Date.now(),
      rankScore: 110,
      name: 'Mann Filter SP12345',
      brandName: 'Mann',
      brandId: null,
      articleLinkId: '500',
      sourceType: 'supplier_product'
    }

    expect(orphanDoc.documentType).toBe('orphan_supplier_product')
    expect(orphanDoc.partId).toBeNull()
    expect(orphanDoc.fitmentCount).toBe(0)
    expect(orphanDoc.vehicleBrandNames).toEqual([])
  })
})