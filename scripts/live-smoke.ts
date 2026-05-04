type SmokeOptions = {
  baseUrl: string
  concurrency: number
  rounds: number
  timeoutMs: number
  maxUrls: number | null
  seoOnly: boolean
}

type TimingResult = {
  url: string
  round: number
  ok: boolean
  status: number | null
  durationMs: number
  timedOut: boolean
  error?: string
}

type SeoResult = {
  url: string
  ok: boolean
  status: number | null
  timedOut: boolean
  hasTitle: boolean
  hasDescription: boolean
  hasCanonical: boolean
  hasHreflangEn: boolean
  hasHreflangTr: boolean
  hasHreflangXDefault: boolean
  hasJsonLd: boolean
  hasNoindex: boolean
  error?: string
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    baseUrl: 'https://www.getirbakim.com',
    concurrency: 20,
    rounds: 2,
    timeoutMs: 12_000,
    maxUrls: null,
    seoOnly: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--base' && next) {
      options.baseUrl = next
      i += 1
      continue
    }

    if (arg === '--concurrency' && next) {
      options.concurrency = Math.max(1, Number.parseInt(next, 10) || 20)
      i += 1
      continue
    }

    if (arg === '--rounds' && next) {
      options.rounds = Math.max(1, Number.parseInt(next, 10) || 2)
      i += 1
      continue
    }

    if (arg === '--timeout' && next) {
      options.timeoutMs = Math.max(1000, Number.parseInt(next, 10) || 12_000)
      i += 1
      continue
    }

    if (arg === '--max-urls' && next) {
      const parsed = Number.parseInt(next, 10)
      options.maxUrls = Number.isFinite(parsed) && parsed > 0 ? parsed : null
      i += 1
      continue
    }

    if (arg === '--seo-only') {
      options.seoOnly = true
    }
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, '')
  return options
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  )
  return sorted[idx]
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, n) => sum + n, 0) / values.length
}

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: boolean; value?: T; error?: unknown }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const value = await work(controller.signal)
    return { timedOut: false, value }
  } catch (error) {
    const timedOut =
      (error instanceof Error && error.name === 'AbortError') || controller.signal.aborted
    return { timedOut, error }
  } finally {
    clearTimeout(timeout)
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function runner() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    runner()
  )
  await Promise.all(runners)
  return results
}

async function fetchText(url: string, timeoutMs: number): Promise<{
  timedOut: boolean
  status: number | null
  body: string
  headers: Headers | null
  error?: string
}> {
  const result = await withTimeout(
    async (signal) => {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal,
        headers: {
          'user-agent': 'getirbakim-live-smoke/1.0'
        }
      })
      const body = await res.text()
      return { res, body }
    },
    timeoutMs
  )

  if (!result.value) {
    const message =
      result.error instanceof Error ? result.error.message : 'request failed'
    return {
      timedOut: result.timedOut,
      status: null,
      body: '',
      headers: null,
      error: message
    }
  }

  return {
    timedOut: false,
    status: result.value.res.status,
    body: result.value.body,
    headers: result.value.res.headers
  }
}

function parseSitemapUrls(xml: string): string[] {
  const locRegex = /<loc>(.*?)<\/loc>/gi
  const urls: string[] = []
  let match: RegExpExecArray | null
  while ((match = locRegex.exec(xml)) !== null) {
    const raw = match[1]?.trim()
    if (!raw) continue
    urls.push(raw)
  }
  return Array.from(new Set(urls))
}

function pickSitemapPath(xmlBody: string): string | null {
  if (xmlBody.includes('<urlset') || xmlBody.includes('<sitemapindex')) {
    return 'valid'
  }
  return null
}

function extractCanonical(html: string): string | null {
  const linkRegex = /<link\s+[^>]*rel=["']canonical["'][^>]*>/gi
  const tag = html.match(linkRegex)?.[0]
  if (!tag) return null
  const hrefMatch = tag.match(/href=["']([^"']+)["']/i)
  return hrefMatch?.[1] ?? null
}

function hasHreflang(html: string, lang: string): boolean {
  const regex = new RegExp(
    `<link\\s+[^>]*hreflang=["']${lang}["'][^>]*>`,
    'i'
  )
  return regex.test(html)
}

function hasNoindexSignal(html: string, headers: Headers | null): boolean {
  const robotsMetaRegex =
    /<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i
  const robotsMeta = robotsMetaRegex.exec(html)?.[1]?.toLowerCase() ?? ''
  const xRobots = headers?.get('x-robots-tag')?.toLowerCase() ?? ''
  return robotsMeta.includes('noindex') || xRobots.includes('noindex')
}

function hasJsonLd(html: string): boolean {
  const regex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>/i
  return regex.test(html)
}

function hasDescriptionMeta(html: string): boolean {
  return /<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']+["'][^>]*>/i.test(
    html
  )
}

function hasTitleTag(html: string): boolean {
  return /<title[^>]*>[^<]+<\/title>/i.test(html)
}

async function runTimingSmoke(
  urls: string[],
  options: SmokeOptions
): Promise<TimingResult[]> {
  const jobs: Array<{ url: string; round: number }> = []
  for (let round = 1; round <= options.rounds; round += 1) {
    for (const url of urls) {
      jobs.push({ url, round })
    }
  }

  return mapWithConcurrency(jobs, options.concurrency, async (job) => {
    const start = performance.now()
    const result = await withTimeout(
      async (signal) =>
        fetch(job.url, {
          method: 'GET',
          redirect: 'follow',
          signal,
          headers: {
            'user-agent': 'getirbakim-live-smoke/1.0'
          }
        }),
      options.timeoutMs
    )
    const durationMs = performance.now() - start

    if (!result.value) {
      const message =
        result.error instanceof Error ? result.error.message : 'request failed'
      return {
        url: job.url,
        round: job.round,
        ok: false,
        status: null,
        durationMs,
        timedOut: result.timedOut,
        error: message
      }
    }

    return {
      url: job.url,
      round: job.round,
      ok: result.value.ok,
      status: result.value.status,
      durationMs,
      timedOut: false
    }
  })
}

async function runSeoSmoke(
  urls: string[],
  options: SmokeOptions
): Promise<SeoResult[]> {
  return mapWithConcurrency(urls, Math.max(4, Math.floor(options.concurrency / 2)), async (url) => {
    const response = await fetchText(url, options.timeoutMs)

    if (!response.status || !response.body) {
      return {
        url,
        ok: false,
        status: response.status,
        timedOut: response.timedOut,
        hasTitle: false,
        hasDescription: false,
        hasCanonical: false,
        hasHreflangEn: false,
        hasHreflangTr: false,
        hasHreflangXDefault: false,
        hasJsonLd: false,
        hasNoindex: false,
        error: response.error
      }
    }

    const html = response.body
    return {
      url,
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      timedOut: false,
      hasTitle: hasTitleTag(html),
      hasDescription: hasDescriptionMeta(html),
      hasCanonical: Boolean(extractCanonical(html)),
      hasHreflangEn: hasHreflang(html, 'en'),
      hasHreflangTr: hasHreflang(html, 'tr'),
      hasHreflangXDefault: hasHreflang(html, 'x-default'),
      hasJsonLd: hasJsonLd(html),
      hasNoindex: hasNoindexSignal(html, response.headers)
    }
  })
}

function printTimingSummary(results: TimingResult[]) {
  const durations = results
    .filter((item) => item.status !== null)
    .map((item) => item.durationMs)
  const okCount = results.filter((item) => item.ok).length
  const status2xx = results.filter(
    (item) => item.status !== null && item.status >= 200 && item.status < 300
  ).length
  const timeoutCount = results.filter((item) => item.timedOut).length
  const total = results.length

  console.log('\n=== GET Smoke Summary ===')
  console.log(`Requests: ${total}`)
  console.log(`2xx: ${status2xx}/${total} (${((status2xx / total) * 100).toFixed(2)}%)`)
  console.log(`OK(fetch ok): ${okCount}/${total} (${((okCount / total) * 100).toFixed(2)}%)`)
  console.log(
    `Timeouts: ${timeoutCount}/${total} (${((timeoutCount / total) * 100).toFixed(2)}%)`
  )
  console.log(`mean: ${mean(durations).toFixed(1)} ms`)
  console.log(`p50: ${percentile(durations, 50).toFixed(1)} ms`)
  console.log(`p90: ${percentile(durations, 90).toFixed(1)} ms`)
  console.log(`p95: ${percentile(durations, 95).toFixed(1)} ms`)
  console.log(`max: ${Math.max(...durations, 0).toFixed(1)} ms`)

  const failed = results.filter((item) => !item.ok || item.timedOut).slice(0, 15)
  if (failed.length > 0) {
    console.log('\nFailed sample:')
    for (const f of failed) {
      console.log(
        `- [round ${f.round}] ${f.status ?? 'ERR'} ${f.url} (${f.durationMs.toFixed(1)} ms)${f.timedOut ? ' TIMEOUT' : ''}`
      )
    }
  }
}

function printSeoSummary(results: SeoResult[]) {
  const eligible = results.filter((item) => item.ok)
  const total = eligible.length

  const count = (key: keyof SeoResult) =>
    eligible.filter((item) => Boolean(item[key])).length

  const canonicalCount = count('hasCanonical')
  const hreflangEnCount = count('hasHreflangEn')
  const hreflangTrCount = count('hasHreflangTr')
  const hreflangXDefaultCount = count('hasHreflangXDefault')
  const jsonLdCount = count('hasJsonLd')
  const noindexCount = count('hasNoindex')
  const titleCount = count('hasTitle')
  const descriptionCount = count('hasDescription')

  console.log('\n=== SEO Smoke Summary ===')
  console.log(`Successful HTML pages: ${total}`)
  if (total === 0) {
    console.log('No successful pages for SEO checks.')
    return
  }

  const fmt = (value: number) => `${value}/${total} (${((value / total) * 100).toFixed(2)}%)`
  console.log(`title: ${fmt(titleCount)}`)
  console.log(`meta description: ${fmt(descriptionCount)}`)
  console.log(`canonical: ${fmt(canonicalCount)}`)
  console.log(`hreflang en: ${fmt(hreflangEnCount)}`)
  console.log(`hreflang tr: ${fmt(hreflangTrCount)}`)
  console.log(`hreflang x-default: ${fmt(hreflangXDefaultCount)}`)
  console.log(`json-ld: ${fmt(jsonLdCount)}`)
  console.log(`unexpected noindex: ${noindexCount}/${total}`)

  const issues = eligible
    .filter(
      (item) =>
        !item.hasCanonical ||
        !item.hasHreflangEn ||
        !item.hasHreflangTr ||
        !item.hasHreflangXDefault ||
        !item.hasJsonLd ||
        item.hasNoindex
    )
    .slice(0, 20)

  if (issues.length > 0) {
    console.log('\nSEO issue sample:')
    for (const issue of issues) {
      const flags: string[] = []
      if (!issue.hasCanonical) flags.push('canonical')
      if (!issue.hasHreflangEn || !issue.hasHreflangTr || !issue.hasHreflangXDefault) {
        flags.push('hreflang')
      }
      if (!issue.hasJsonLd) flags.push('json-ld')
      if (issue.hasNoindex) flags.push('noindex')
      console.log(`- ${issue.url} -> ${flags.join(', ')}`)
    }
  }
}

async function getSitemapUrls(options: SmokeOptions): Promise<string[]> {
  const primaryUrl = `${options.baseUrl}/sitemap.xml`
  const fallbackUrl = `${options.baseUrl}/en/sitemap.xml`
  const candidates = [primaryUrl, fallbackUrl]

  for (const candidate of candidates) {
    const response = await fetchText(candidate, options.timeoutMs)
    if (!response.status || !response.body) continue
    if (response.status < 200 || response.status >= 300) continue
    if (!pickSitemapPath(response.body)) continue

    const urls = parseSitemapUrls(response.body)
    if (urls.length > 0) {
      return urls
    }
  }

  throw new Error('No valid sitemap URL list found from /sitemap.xml or /en/sitemap.xml')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const startedAt = new Date().toISOString()

  console.log('Live smoke started:', startedAt)
  console.log('Options:', JSON.stringify(options))

  const sitemapUrls = await getSitemapUrls(options)
  const urls =
    options.maxUrls && options.maxUrls > 0
      ? sitemapUrls.slice(0, options.maxUrls)
      : sitemapUrls

  console.log(`Sitemap URLs discovered: ${sitemapUrls.length}`)
  console.log(`URLs selected for run: ${urls.length}`)

  if (!options.seoOnly) {
    const timingResults = await runTimingSmoke(urls, options)
    printTimingSummary(timingResults)
  }

  const seoResults = await runSeoSmoke(urls, options)
  printSeoSummary(seoResults)

  console.log('\nLive smoke finished:', new Date().toISOString())
}

void main().catch((error) => {
  console.error('Live smoke failed:', error)
  process.exit(1)
})
