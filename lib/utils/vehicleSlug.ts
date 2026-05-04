/**
 * Extract the canonical `vehicle_types.id` from a catalog/search vehicle slug.
 */
export function extractVehicleTypeIdFromSlug(slug: string): number | null {
  if (!slug) return null

  const vehicleTypeMatch = slug.match(/-(\d+)-vtid$/i)
  if (vehicleTypeMatch) {
    const vehicleTypeId = Number.parseInt(vehicleTypeMatch[1] ?? '', 10)
    return Number.isFinite(vehicleTypeId) && vehicleTypeId > 0
      ? vehicleTypeId
      : null
  }

  const parts = slug.split('-')
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]
    const num = Number.parseInt(part, 10)

    if (!isNaN(num) && num >= 1000 && num <= 999999) {
      return num
    }
  }

  return null
}

export interface VehicleSelectionLike {
  id?: string | number | null
  urlKey?: string | null
  vehicleTypeId?: number | null
}

export function resolveVehicleTypeId(
  vehicle: VehicleSelectionLike | null | undefined
): number | null {
  if (!vehicle) return null

  if (
    typeof vehicle.vehicleTypeId === 'number' &&
    Number.isFinite(vehicle.vehicleTypeId) &&
    vehicle.vehicleTypeId > 0
  ) {
    return vehicle.vehicleTypeId
  }

  if (typeof vehicle.id === 'number' && Number.isFinite(vehicle.id) && vehicle.id > 0) {
    return vehicle.id
  }

  if (typeof vehicle.id === 'string') {
    const parsedId = Number.parseInt(vehicle.id, 10)
    if (Number.isFinite(parsedId) && parsedId > 0) {
      return parsedId
    }
  }

  return extractVehicleTypeIdFromSlug(vehicle.urlKey ?? '')
}
