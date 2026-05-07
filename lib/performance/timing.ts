const PERFORMANCE_LOGGING =
  process.env.PERFORMANCE_LOGGING === 'true'
const SLOW_QUERY_THRESHOLD = parseInt(
  process.env.SLOW_QUERY_THRESHOLD || '500',
  10
)

export interface TimingMarker {
  name: string
  startMs: number
}

export interface TimingResult {
  name: string
  durationMs: number
  metadata?: Record<string, unknown>
}

const activeTimers = new Map<string, number>()

export function startTimer(name: string): TimingMarker {
  const startMs = performance.now()
  activeTimers.set(name, startMs)
  return { name, startMs }
}

export function endTimer(
  marker: TimingMarker,
  metadata?: Record<string, unknown>
): TimingResult {
  const durationMs = Number((performance.now() - marker.startMs).toFixed(2))
  activeTimers.delete(marker.name)

  const result: TimingResult = { name: marker.name, durationMs, metadata }

  if (PERFORMANCE_LOGGING || durationMs > SLOW_QUERY_THRESHOLD) {
    const metaStr = metadata
      ? ` ${Object.entries(metadata)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`
      : ''
    const level = durationMs > SLOW_QUERY_THRESHOLD ? 'warn' : 'info'
    if (level === 'warn') {
      console.warn(
        `[perf:slow] ${marker.name} ${durationMs}ms${metaStr}`
      )
    } else {
      console.info(
        `[perf] ${marker.name} ${durationMs}ms${metaStr}`
      )
    }
  }

  return result
}

export function createTimerGroup(label: string) {
  const markers: TimingMarker[] = []
  const results: TimingResult[] = []

  return {
    start(name: string): TimingMarker {
      const marker = startTimer(`${label}:${name}`)
      markers.push(marker)
      return marker
    },
    end(marker: TimingMarker, metadata?: Record<string, unknown>): TimingResult {
      const result = endTimer(marker, metadata)
      results.push(result)
      return result
    },
    getResults(): TimingResult[] {
      return [...results]
    },
    getTotalMs(): number {
      return Number(
        results.reduce((sum, r) => sum + r.durationMs, 0).toFixed(2)
      )
    },
    formatServerTiming(): string {
      return results
        .map((r) => `${r.name.split(':').pop()};dur=${r.durationMs}`)
        .join(', ')
    },
    logSummary(): void {
      if (!PERFORMANCE_LOGGING) return
      const total = this.getTotalMs()
      const breakdown = results
        .map((r) => `${r.name.split(':').pop()}=${r.durationMs}ms`)
        .join(', ')
      console.info(
        `[perf:group] ${label} total=${total}ms (${breakdown})`
      )
    }
  }
}

export { PERFORMANCE_LOGGING, SLOW_QUERY_THRESHOLD }