// Type definitions for the application

export enum Category {
  Oils = 'Oils',
  Filters = 'Filters',
  Wipers = 'Wipers',
  Brakes = 'Brakes',
  All = 'All'
}

export interface Vehicle {
  id: string
  year: number
  make: string
  model: string
  engine: string
  fuel?: string
  variant?: string
  urlKey?: string
  vehicleTypeId?: number
}

export interface Product {
  id: string
  name: string
  brand: string
  price: number
  category: Category
  rating: number
  reviews: number
  imageUrl: string
  compatibleVehicles: string[]
  stock: number
  tags?: string[]
  isPromo?: boolean
}

export interface CartItem {
  partId: number
  id: string
  name: string
  brand: string
  price: number
  quantity: number
  imageUrl: string
}

export interface FilterState {
  category: Category | string
  brand: string
  vehicleMake: string
  minPrice: number
  maxPrice: number
  categoryId?: number
}
