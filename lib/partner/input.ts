import { normalizeCode } from '@/lib/matching/code-normalization'

export const MAX_VEHICLE_TYPE_ID = 2_147_483_647

/** Exact manufacturer part identity used by the bounded partner lookup. */
export function normalizePartnerPartNo(raw: string | null): string | null {
  if (raw == null) return null
  const normalized = normalizeCode(raw)
  return normalized.length > 0 ? normalized : null
}

export function buildPartnerPartNoFilter(raw: string):
  | { status: 'ACTIVE'; part_no_norm: string }
  | null {
  const normalized = normalizePartnerPartNo(raw)
  return normalized == null ? null : { status: 'ACTIVE', part_no_norm: normalized }
}

export function parsePartnerVehicleTypeId(raw: string | null):
  | { valid: true; value: number | null }
  | { valid: false; value: null } {
  if (raw == null) return { valid: true, value: null }
  if (!/^[1-9]\d*$/.test(raw)) return { valid: false, value: null }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value <= MAX_VEHICLE_TYPE_ID
    ? { valid: true, value }
    : { valid: false, value: null }
}
