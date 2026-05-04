'use server'

import { db } from '@/lib/db'
import { Vehicle } from '@/types'

export async function getUserVehicles(userId: string) {
  try {
    const vehicles = await db.user_vehicles.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    })

    // Prisma jsonb type returns the object directly
    return vehicles.map((v) => ({
      ...v,
      id: v.id,
      userId: v.user_id,
      vehicleData: v.vehicle_data,
      createdAt: v.created_at,
      vehicle: v.vehicle_data as unknown as Vehicle
    }))
  } catch (error) {
    console.error('Failed to get user vehicles:', error)
    return []
  }
}

export async function addUserVehicle(userId: string, vehicle: Vehicle) {
  try {
    await db.user_vehicles.create({
      data: {
        user_id: userId,
        vehicle_data: vehicle as any
      }
    })
    return { success: true }
  } catch (error) {
    console.error('Failed to add user vehicle:', error)
    return { success: false, error }
  }
}

export async function removeUserVehicle(userId: string, userVehicleId: number) {
  try {
    await db.user_vehicles.delete({
      where: {
        id: userVehicleId,
        user_id: userId
      }
    })
    return { success: true }
  } catch (error) {
    console.error('Failed to remove user vehicle:', error)
    return { success: false, error }
  }
}
