import { describe, it, expect } from 'bun:test'
import {
  CSV_BOM,
  csvCell,
  csvLine,
  detectCsvDelimiter,
  formatCsvBoolean,
  formatCsvNumber,
  parseCsvBoolean,
  parseCsvNumber,
  parseCsvRows,
  unescapeCsvCell
} from './csv'
import { normalizeCsvHeader } from './product-csv-schema'

describe('csvCell', () => {
  it('ayraç, tırnak ve satır sonu içeren hücreyi tırnaklar', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('de"mir')).toBe('"de""mir"')
    expect(csvCell('iki\nsatır')).toBe('"iki\nsatır"')
  })

  it('virgül ayraçta noktalı virgülü tırnaklamaz', () => {
    expect(csvCell('a;b', ',')).toBe('a;b')
    expect(csvCell('a,b', ',')).toBe('"a,b"')
  })

  it('formülle başlayan hücreyi kaçırır ve kaçış geri alınabilir', () => {
    const escaped = csvCell('=1+1')
    expect(escaped).toBe("'=1+1")
    expect(unescapeCsvCell(escaped)).toBe('=1+1')
  })

  it('formül olmayan tek tırnağı bozmaz', () => {
    expect(unescapeCsvCell("'ABC")).toBe("'ABC")
  })

  it('null/undefined boş hücre olur', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})

describe('parseCsvRows', () => {
  it('tırnaklı alanları, gömülü ayracı ve satır sonunu çözer', () => {
    const text = 'a;b;c\r\n1;"x;y";"iki\nsatır"\r\n'
    expect(parseCsvRows(text, ';')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', 'iki\nsatır']
    ])
  })

  it('BOM ve sondaki boş satırı atar', () => {
    expect(parseCsvRows(`${CSV_BOM}a;b\r\n1;2\r\n\r\n`, ';')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('kaçırılmış çift tırnağı tek tırnağa indirir', () => {
    expect(parseCsvRows('x\r\n"de""mir"\r\n', ';')).toEqual([['x'], ['de"mir']])
  })

  it('csvLine ile gidiş-dönüş bozulmaz', () => {
    const values = ['dinamik', '12', 'A;B', 'de"mir', '=formul', 'iki\nsatır']
    const [row] = parseCsvRows(csvLine(values), ';')
    expect(row!.map(unescapeCsvCell)).toEqual(values)
  })
})

describe('detectCsvDelimiter', () => {
  it('başlıktaki baskın ayracı seçer', () => {
    expect(detectCsvDelimiter('a;b;c\r\n1;2;3')).toBe(';')
    expect(detectCsvDelimiter('a,b,c\r\n1,2,3')).toBe(',')
    expect(detectCsvDelimiter('a\tb\tc\r\n1\t2\t3')).toBe('\t')
  })

  it('tırnak içindeki ayracı saymaz', () => {
    expect(detectCsvDelimiter('"a,b,c,d";x\r\n')).toBe(';')
  })

  it('tek sütunlu dosyada varsayılana düşer', () => {
    expect(detectCsvDelimiter('supplier\r\ndinamik')).toBe(';')
  })
})

describe('parseCsvNumber', () => {
  it('TR ve EN biçimlerini okur', () => {
    expect(parseCsvNumber('1.234,56')).toBe(1234.56)
    expect(parseCsvNumber('1234,56')).toBe(1234.56)
    expect(parseCsvNumber('1234.56')).toBe(1234.56)
    expect(parseCsvNumber('1,234.56')).toBe(1234.56)
    expect(parseCsvNumber('1234')).toBe(1234)
  })

  it('binlik gruplamayı ondalık sanmaz', () => {
    expect(parseCsvNumber('1.234')).toBe(1234)
    expect(parseCsvNumber('1.234.567')).toBe(1234567)
  })

  it('boş hücre null, çöp hücre NaN', () => {
    expect(parseCsvNumber('')).toBeNull()
    expect(parseCsvNumber('   ')).toBeNull()
    expect(Number.isNaN(parseCsvNumber('abc') as number)).toBe(true)
  })

  it('formatCsvNumber ile gidiş-dönüş korunur', () => {
    expect(parseCsvNumber(formatCsvNumber(1249.9))).toBe(1249.9)
    expect(formatCsvNumber(null)).toBe('')
  })
})

describe('parseCsvBoolean', () => {
  it('TR/EN yazımları anlar', () => {
    for (const v of ['EVET', 'evet', 'true', '1', 'X']) expect(parseCsvBoolean(v)).toBe(true)
    for (const v of ['HAYIR', 'hayır', 'false', '0', '']) expect(parseCsvBoolean(v)).toBe(false)
  })

  it('anlaşılmayan değerde null döner', () => {
    expect(parseCsvBoolean('belki')).toBeNull()
  })

  it('formatCsvBoolean ile gidiş-dönüş korunur', () => {
    expect(parseCsvBoolean(formatCsvBoolean(true))).toBe(true)
    expect(parseCsvBoolean(formatCsvBoolean(false))).toBe(false)
  })
})

describe('normalizeCsvHeader', () => {
  it('büyük harf/boşluk toleranslıdır', () => {
    expect(normalizeCsvHeader('  Supplier Product ID ')).toBe('supplier_product_id')
    expect(normalizeCsvHeader('NAME_OVERRIDE')).toBe('name_override')
  })

  it('Türkçe takma adları çözer', () => {
    expect(normalizeCsvHeader('firma')).toBe('supplier')
    expect(normalizeCsvHeader('kanonik_urun_id')).toBe('canonical_product_id')
  })

  it('tanımadığı başlığa null döner', () => {
    expect(normalizeCsvHeader('rastgele')).toBeNull()
  })
})
