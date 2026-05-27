export function isRedisAvailable(): boolean {
  return false
}

export async function getFromCache<T>(_key: string): Promise<T | null> {
  return null
}

export async function setCache<T>(
  _key: string,
  _value: T,
  _ttlSeconds: number
): Promise<boolean> {
  return false
}

export async function deleteCache(_key: string): Promise<boolean> {
  return false
}

export async function deleteCachePattern(_pattern: string): Promise<boolean> {
  return false
}
