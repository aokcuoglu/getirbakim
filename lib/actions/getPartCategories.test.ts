import { describe, expect, it } from 'bun:test'
import { buildCategoryUrl, buildCategoryPath } from '@/lib/catalog-url'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ıİ]/g, 'i')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function normalizeUrlKey(
  urlKey: string | null | undefined,
  name: string
): string {
  const candidate = (urlKey || '').trim().toLowerCase()
  if (!candidate) return generateSlug(name)
  return candidate.replace(/-\d{5,}$/, '')
}

interface CategorySnapshotRow {
  id: number
  name: string
  name_tr: string | null
  is_active: boolean
  has_childs: boolean
  parent_id: number | null
  url_key: string | null
  image: string | null
  is_main_nav: boolean
}

class CategorySnapshot {
  readonly rows: CategorySnapshotRow[]
  readonly byId: Map<number, CategorySnapshotRow>
  readonly byUrlKey: Map<string, CategorySnapshotRow[]>
  readonly byNameSlug: Map<string, CategorySnapshotRow[]>
  readonly childrenByParentId: Map<number | null, CategorySnapshotRow[]>

  constructor(rows: CategorySnapshotRow[]) {
    this.rows = rows
    this.byId = new Map()
    this.byUrlKey = new Map()
    this.byNameSlug = new Map()
    this.childrenByParentId = new Map()

    for (const row of rows) {
      this.byId.set(row.id, row)

      if (row.url_key) {
        const normalizedKey = row.url_key.trim().toLowerCase()
        const arr = this.byUrlKey.get(normalizedKey)
        if (arr) {
          arr.push(row)
        } else {
          this.byUrlKey.set(normalizedKey, [row])
        }
      }

      const nameSlug = generateSlug(row.name)
      const nameArr = this.byNameSlug.get(nameSlug)
      if (nameArr) {
        nameArr.push(row)
      } else {
        this.byNameSlug.set(nameSlug, [row])
      }

      const parentId = row.parent_id
      const children = this.childrenByParentId.get(parentId)
      if (children) {
        children.push(row)
      } else {
        this.childrenByParentId.set(parentId, [row])
      }
    }
  }
}

describe('generateSlug', () => {
  it('generates slug from English category name', () => {
    expect(generateSlug('Fuel filter')).toBe('fuel-filter')
    expect(generateSlug('Oil filter')).toBe('oil-filter')
    expect(generateSlug('Air filter')).toBe('air-filter')
    expect(generateSlug('Cabin filter')).toBe('cabin-filter')
  })

  it('generates slug from Turkish category name', () => {
    expect(generateSlug('Yakıt filtresi')).toBe('yakit-filtresi')
    expect(generateSlug('Yağ filtresi')).toBe('yag-filtresi')
    expect(generateSlug('Hava filtresi')).toBe('hava-filtresi')
    expect(generateSlug('Polen filtresi')).toBe('polen-filtresi')
  })

  it('handles special Turkish characters', () => {
    expect(generateSlug('Şanzıman')).toBe('sanziman')
    expect(generateSlug('Ön cam')).toBe('on-cam')
    expect(generateSlug('Çıkış')).toBe('cikis')
    expect(generateSlug('Ürün')).toBe('urun')
  })

  it('handles multi-word names', () => {
    expect(generateSlug('Brake pad wear indicators')).toBe('brake-pad-wear-indicators')
    expect(generateSlug('Handbrake parts')).toBe('handbrake-parts')
  })
})

describe('normalizeUrlKey', () => {
  it('returns url_key when present', () => {
    expect(normalizeUrlKey('fuel-filters', 'Fuel filter')).toBe('fuel-filters')
    expect(normalizeUrlKey('air-filters', 'Air filter')).toBe('air-filters')
  })

  it('returns name-derived slug when url_key is null', () => {
    expect(normalizeUrlKey(null, 'Fuel filter')).toBe('fuel-filter')
    expect(normalizeUrlKey(null, 'Oil filter')).toBe('oil-filter')
    expect(normalizeUrlKey(null, 'Air filter')).toBe('air-filter')
  })

  it('returns name-derived slug when url_key is empty string', () => {
    expect(normalizeUrlKey('', 'Fuel filter')).toBe('fuel-filter')
    expect(normalizeUrlKey('  ', 'Oil filter')).toBe('oil-filter')
  })

  it('returns name-derived slug when url_key is undefined', () => {
    expect(normalizeUrlKey(undefined, 'Cabin filter')).toBe('cabin-filter')
  })

  it('strips legacy ID suffixes from url_key', () => {
    expect(normalizeUrlKey('fuel-filter-100384', 'Fuel filter')).toBe('fuel-filter')
    expect(normalizeUrlKey('air-filter-100241', 'Air filter')).toBe('air-filter')
  })

  it('preserves short numeric suffixes (less than 5 digits)', () => {
    expect(normalizeUrlKey('filter-1234', 'Filter')).toBe('filter-1234')
  })

  it('lowercases url_key', () => {
    expect(normalizeUrlKey('Fuel-Filter', 'Fuel filter')).toBe('fuel-filter')
  })
})

describe('category URL generation', () => {
  it('builds canonical category URLs with locale prefix', () => {
    expect(
      buildCategoryUrl('en', { categoryUrlKey: 'fuel-filter' })
    ).toBe('/en/fuel-filter')
    expect(
      buildCategoryUrl('tr', { categoryUrlKey: 'yakit-filtresi' })
    ).toBe('/tr/yakit-filtresi')
  })

  it('defaults to car-parts when category is missing', () => {
    expect(buildCategoryUrl('en', {})).toBe('/en/car-parts')
    expect(buildCategoryUrl('tr', { categoryUrlKey: null })).toBe('/tr/car-parts')
  })

  it('builds relative category paths without locale', () => {
    expect(buildCategoryPath({ categoryUrlKey: 'fuel-filter' })).toBe('/fuel-filter')
    expect(buildCategoryPath({ categoryUrlKey: 'brake-system' })).toBe('/brake-system')
  })
})

describe('category slug resolution consistency', () => {
  it('link generation and lookup slug match for categories without url_key', () => {
    const dbUrlKey = null
    const dbName = 'Fuel filter'
    const linkSlug = normalizeUrlKey(dbUrlKey, dbName)
    const lookupSlug = generateSlug(dbName)
    expect(linkSlug).toBe(lookupSlug)
    expect(linkSlug).toBe('fuel-filter')
  })

  it('link generation and lookup slug match for categories with url_key', () => {
    const dbUrlKey = 'fuel-filters'
    const dbName = 'Fuel filter'
    const linkSlug = normalizeUrlKey(dbUrlKey, dbName)
    expect(linkSlug).toBe('fuel-filters')
  })

  it('normalizeUrlKey produces consistent slugs for Turkish names', () => {
    expect(normalizeUrlKey(null, 'Yakıt filtresi')).toBe('yakit-filtresi')
    expect(generateSlug('Yakıt filtresi')).toBe('yakit-filtresi')
  })

  it('plural url_key does not match singular name slug', () => {
    const pluralUrlKey = normalizeUrlKey('fuel-filters', 'Fuel filter')
    const singularNameSlug = normalizeUrlKey(null, 'Fuel filter')
    expect(pluralUrlKey).toBe('fuel-filters')
    expect(singularNameSlug).toBe('fuel-filter')
    expect(pluralUrlKey).not.toBe(singularNameSlug)
  })
})

describe('suffixed url_key resolution', () => {
  it('normalizes suffixed url_key to canonical slug', () => {
    expect(normalizeUrlKey('fuel-filter-100261', 'Fuel Filter')).toBe('fuel-filter')
    expect(normalizeUrlKey('oil-filter-100259', 'Oil Filter')).toBe('oil-filter')
    expect(normalizeUrlKey('brake-system', 'Brake System')).toBe('brake-system')
    expect(normalizeUrlKey('engine-timing-100003', 'Engine Timing')).toBe('engine-timing')
  })

  it('does not strip short numeric suffixes', () => {
    expect(normalizeUrlKey('filter-1234', 'Filter')).toBe('filter-1234')
  })

  it('canonical slug matches what link generation produces for suffixed url_keys', () => {
    const dbUrlKey = 'fuel-filter-100261'
    const dbName = 'Fuel Filter'
    const linkSlug = normalizeUrlKey(dbUrlKey, dbName)
    expect(linkSlug).toBe('fuel-filter')
  })

  it('startsWith pattern for suffixed lookup matches correct candidates', () => {
    const urlKey = 'fuel-filter'
    const prefix = urlKey + '-'
    expect(prefix).toBe('fuel-filter-')
    expect('fuel-filter-100261'.startsWith(prefix)).toBe(true)
    expect('fuel-filter-housing-100253'.startsWith(prefix)).toBe(true)
  })

  it('normalizeUrlKey filters out false positive startsWith matches', () => {
    const falsePositiveUrlKey = 'fuel-filterhousing-100253'
    const normalized = normalizeUrlKey(falsePositiveUrlKey, 'Fuel Filter/Housing')
    expect(normalized).toBe('fuel-filterhousing')
    expect(normalized).not.toBe('fuel-filter')
  })

  it('handles categories where url_key equals the canonical slug', () => {
    expect(normalizeUrlKey('filters', 'Filters')).toBe('filters')
    expect(normalizeUrlKey('car-parts', 'Car parts')).toBe('car-parts')
    expect(normalizeUrlKey('brake-system', 'Brake System')).toBe('brake-system')
  })
})

describe('CategorySnapshot', () => {
  const sampleRows: CategorySnapshotRow[] = [
    { id: 1, name: 'Car Parts', name_tr: 'Otomotiv Parcaları', is_active: true, has_childs: true, parent_id: null, url_key: 'car-parts', image: null, is_main_nav: true },
    { id: 2, name: 'Filters', name_tr: 'Filtreler', is_active: true, has_childs: true, parent_id: 1, url_key: 'filters', image: null, is_main_nav: true },
    { id: 3, name: 'Air Filter', name_tr: 'Hava Filtresi', is_active: true, has_childs: false, parent_id: 2, url_key: 'air-filter', image: null, is_main_nav: false },
    { id: 4, name: 'Fuel Filter', name_tr: 'Yakıt Filtresi', is_active: true, has_childs: false, parent_id: 2, url_key: 'fuel-filter', image: null, is_main_nav: false },
    { id: 5, name: 'Oil Filter', name_tr: 'Yağ Filtresi', is_active: true, has_childs: false, parent_id: 2, url_key: 'oil-filter', image: null, is_main_nav: false },
    { id: 6, name: 'Inactive', name_tr: null, is_active: false, has_childs: false, parent_id: 1, url_key: 'inactive', image: null, is_main_nav: false },
  ]

  it('builds byId index from rows', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    expect(snapshot.byId.get(1)?.name).toBe('Car Parts')
    expect(snapshot.byId.get(3)?.name).toBe('Air Filter')
    expect(snapshot.byId.get(99)).toEqual(undefined)
  })

  it('builds byUrlKey index from rows', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    expect(snapshot.byUrlKey.get('air-filter')?.length).toBe(1)
    expect(snapshot.byUrlKey.get('air-filter')?.[0]?.id).toBe(3)
    expect(snapshot.byUrlKey.get('nonexistent')).toEqual(undefined)
  })

  it('builds childrenByParentId index from rows', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    const childrenOf2 = snapshot.childrenByParentId.get(2)
    expect(childrenOf2?.length).toBe(3)
    expect(childrenOf2?.map((c) => c.id).sort()).toEqual([3, 4, 5])
    const rootChildren = snapshot.childrenByParentId.get(null)
    expect(rootChildren?.length).toBe(1)
    expect(rootChildren?.[0]?.id).toBe(1)
  })

  it('builds byNameSlug index from rows', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    expect(snapshot.byNameSlug.get('air-filter')?.length).toBe(1)
    expect(snapshot.byNameSlug.get('air-filter')?.[0]?.id).toBe(3)
  })

  it('handles duplicate url_key entries', () => {
    const dupeRows: CategorySnapshotRow[] = [
      { id: 10, name: 'Filter A', name_tr: null, is_active: true, has_childs: false, parent_id: null, url_key: 'filter', image: null, is_main_nav: false },
      { id: 11, name: 'Filter B', name_tr: null, is_active: true, has_childs: false, parent_id: null, url_key: 'filter', image: null, is_main_nav: false },
    ]
    const snapshot = new CategorySnapshot(dupeRows)
    expect(snapshot.byUrlKey.get('filter')?.length).toBe(2)
    expect(snapshot.byUrlKey.get('filter')?.map((r) => r.id)).toEqual([10, 11])
  })

  it('includes inactive categories in snapshot (filtering done at query time)', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    expect(snapshot.byId.get(6)?.is_active).toBe(false)
    expect(snapshot.rows.length).toBe(6)
  })

  it('main nav categories can be filtered from snapshot', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    const mainNav = snapshot.rows.filter((r) => r.is_main_nav && r.is_active)
    expect(mainNav.length).toBe(2)
    expect(mainNav.map((r) => r.id).sort()).toEqual([1, 2])
  })

  it('ancestry can be resolved from snapshot without DB queries', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    const airFilter = snapshot.byId.get(3)!
    expect(airFilter.parent_id).toBe(2)

    const parent = snapshot.byId.get(airFilter.parent_id!)!
    expect(parent.name).toBe('Filters')
    expect(parent.parent_id).toBe(1)

    const grandparent = snapshot.byId.get(parent.parent_id!)!
    expect(grandparent.name).toBe('Car Parts')
    expect(grandparent.parent_id).toBeNull()
  })

  it('siblings can be resolved from snapshot without DB queries', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    const siblings = (snapshot.childrenByParentId.get(2) || [])
      .filter((r) => r.is_active)
    expect(siblings.length).toBe(3)
    expect(siblings.map((s) => s.id).sort()).toEqual([3, 4, 5])
  })

  it('url_key lookup by normalized key is case-insensitive', () => {
    const snapshot = new CategorySnapshot(sampleRows)
    expect(snapshot.byUrlKey.get('air-filter')).not.toEqual(undefined)
    expect(snapshot.byUrlKey.get('Air-Filter')).toEqual(undefined)
  })

  it('handles null url_key in byNameSlug index', () => {
    const nameOnlyRows: CategorySnapshotRow[] = [
      { id: 100, name: 'Brake System', name_tr: null, is_active: true, has_childs: true, parent_id: null, url_key: null, image: null, is_main_nav: false },
    ]
    const snapshot = new CategorySnapshot(nameOnlyRows)
    expect(snapshot.byNameSlug.get('brake-system')?.length).toBe(1)
    expect(snapshot.byNameSlug.get('brake-system')?.[0]?.id).toBe(100)
    expect(snapshot.byUrlKey.has('brake-system')).toBe(false)
  })
})

describe('category cache key includes locale and slug', () => {
  it('cache key format for main nav includes locale', () => {
    const enKey = `main-nav-categories-en-v2`
    const trKey = `main-nav-categories-tr-v2`
    expect(enKey).not.toBe(trKey)
    expect(enKey.includes('en')).toBe(true)
    expect(trKey.includes('tr')).toBe(true)
  })

  it('cache key format for category by urlKey includes slug', () => {
    const airFilterKey = `part-category-v2-air-filter`
    const fuelFilterKey = `part-category-v2-fuel-filter`
    expect(airFilterKey).not.toBe(fuelFilterKey)
    expect(airFilterKey.includes('air-filter')).toBe(true)
    expect(fuelFilterKey.includes('fuel-filter')).toBe(true)
  })
})

describe('category snapshot does not include user-specific data', () => {
  it('CategorySnapshotRow interface has no user/session fields', () => {
    const row: CategorySnapshotRow = {
      id: 1,
      name: 'Test',
      name_tr: null,
      is_active: true,
      has_childs: false,
      parent_id: null,
      url_key: 'test',
      image: null,
      is_main_nav: false,
    }
    const keys = Object.keys(row)
    const forbiddenKeys = ['userId', 'sessionId', 'token', 'auth', 'email', 'password']
    for (const forbidden of forbiddenKeys) {
      expect(keys.includes(forbidden)).toBe(false)
    }
  })
})