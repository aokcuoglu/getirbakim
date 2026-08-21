export const MAX_VEHICLE_TYPE_ID = 2_147_483_647

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
