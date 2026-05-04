export interface VehicleNode {
  id: string
  label: string
  children?: VehicleNode[]
  type: 'MAKE' | 'MODEL' | 'VEHICLE' | 'FUEL' | 'ENGINE' | 'VARIANT'
  payload?: any // Extra data like year range, power, etc.
}

// Data removed in favor of DB
