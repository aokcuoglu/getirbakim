import { describe, expect, it } from 'bun:test'
import {
  buildPrioritizedQueue,
  normalizeInfoRowsWithSpareInfo,
  normalizePartPropertyRows
} from './article-info-sync-helpers'

describe('normalizeInfoRowsWithSpareInfo', () => {
  it('merges partInfo + spareInfo and deduplicates', () => {
    const rows = normalizeInfoRowsWithSpareInfo(
      ['Alpha', 'Beta', 'Alpha', '  '],
      'Beta'
    )

    expect(rows).toEqual(['Alpha', 'Beta'])
  })
})

describe('normalizePartPropertyRows', () => {
  it('normalizes and deduplicates case-insensitively', () => {
    const rows = normalizePartPropertyRows({
      Voltage: '12',
      voltage: '12',
      '  Socket Type ': 'BA15s',
      Empty: '',
      Nullish: null
    })

    expect(rows).toEqual([
      { key: 'Voltage', value: '12' },
      { key: 'Socket Type', value: 'BA15s' }
    ])
  })
})

describe('buildPrioritizedQueue', () => {
  it('keeps seed rows first and deduplicates by part id', () => {
    const queue = buildPrioritizedQueue(
      [
        { id: BigInt(40) },
        { id: BigInt(10) }
      ],
      [
        { id: BigInt(10) },
        { id: BigInt(20) },
        { id: BigInt(30) }
      ]
    )

    expect(queue.map((row) => row.id.toString())).toEqual([
      '40',
      '10',
      '20',
      '30'
    ])
  })
})
