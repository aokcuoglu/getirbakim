/**
 * Query Monitor - Stub for tracking database query performance
 *
 * This is a placeholder implementation. In production, you would
 * integrate with your actual monitoring solution (DataDog, NewRelic, etc.)
 */

interface QueryStats {
  totalQueries: number
  slowQueries: number
  avgDuration: number
  byOperation: Record<
    string,
    {
      count: number
      totalDuration: number
      avgDuration: number
    }
  >
}

interface SlowQuery {
  query: string
  duration: number
  timestamp: Date
}

// In-memory storage for development
const queryStats: QueryStats = {
  totalQueries: 0,
  slowQueries: 0,
  avgDuration: 0,
  byOperation: {}
}

const slowQueryLog: SlowQuery[] = []
const MAX_SLOW_QUERIES = 1000

/**
 * Record a query execution for monitoring
 */
export function recordQuery(
  operation: string,
  duration: number,
  query?: string
): void {
  queryStats.totalQueries++

  // Update average
  queryStats.avgDuration =
    (queryStats.avgDuration * (queryStats.totalQueries - 1) + duration) /
    queryStats.totalQueries

  // Track by operation
  if (!queryStats.byOperation[operation]) {
    queryStats.byOperation[operation] = {
      count: 0,
      totalDuration: 0,
      avgDuration: 0
    }
  }

  const opStats = queryStats.byOperation[operation]
  opStats.count++
  opStats.totalDuration += duration
  opStats.avgDuration = opStats.totalDuration / opStats.count

  // Track slow queries
  const slowThreshold = parseInt(process.env.SLOW_QUERY_THRESHOLD || '1000', 10)
  if (duration > slowThreshold) {
    queryStats.slowQueries++

    slowQueryLog.push({
      query: query || operation,
      duration,
      timestamp: new Date()
    })

    // Keep only the last N slow queries
    if (slowQueryLog.length > MAX_SLOW_QUERIES) {
      slowQueryLog.shift()
    }
  }
}

/**
 * Get current query statistics
 */
export function getQueryStats(): QueryStats {
  return { ...queryStats }
}

/**
 * Get slow queries above a threshold
 */
export function getSlowQueries(threshold?: number): SlowQuery[] {
  const minThreshold =
    threshold || parseInt(process.env.SLOW_QUERY_THRESHOLD || '1000', 10)
  return slowQueryLog.filter((q) => q.duration >= minThreshold)
}

/**
 * Reset query statistics (useful for testing)
 */
export function resetQueryStats(): void {
  queryStats.totalQueries = 0
  queryStats.slowQueries = 0
  queryStats.avgDuration = 0
  queryStats.byOperation = {}
  slowQueryLog.length = 0
}
