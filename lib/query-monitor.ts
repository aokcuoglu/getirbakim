const SLOW_THRESHOLD = parseInt(
  process.env.SLOW_QUERY_THRESHOLD || '500',
  10
)

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

const queryStats: QueryStats = {
  totalQueries: 0,
  slowQueries: 0,
  avgDuration: 0,
  byOperation: {}
}

const slowQueryLog: SlowQuery[] = []
const MAX_SLOW_QUERIES = 1000

export function recordQuery(
  operation: string,
  duration: number,
  query?: string
): void {
  queryStats.totalQueries++

  queryStats.avgDuration =
    (queryStats.avgDuration * (queryStats.totalQueries - 1) + duration) /
    queryStats.totalQueries

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

  if (duration > SLOW_THRESHOLD) {
    queryStats.slowQueries++

    slowQueryLog.push({
      query: query || operation,
      duration,
      timestamp: new Date()
    })

    if (slowQueryLog.length > MAX_SLOW_QUERIES) {
      slowQueryLog.shift()
    }
  }
}

export function getQueryStats(): QueryStats {
  return { ...queryStats }
}

export function getSlowQueries(threshold?: number): SlowQuery[] {
  const minThreshold = threshold || SLOW_THRESHOLD
  return slowQueryLog.filter((q) => q.duration >= minThreshold)
}

export function resetQueryStats(): void {
  queryStats.totalQueries = 0
  queryStats.slowQueries = 0
  queryStats.avgDuration = 0
  queryStats.byOperation = {}
  slowQueryLog.length = 0
}