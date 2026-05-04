/**
 * API client utilities
 */

export class ApiClientError extends Error {
  status: number

  constructor(message: string, status: number = 500) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

export async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiClientError(
      data.error ||
        data.message ||
        `Request failed with status ${response.status}`,
      response.status
    )
  }

  return response.json()
}
