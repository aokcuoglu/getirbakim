import 'dotenv/config'
import { fetch as undiciFetch, ProxyAgent, Agent } from 'undici'

const DINAMIK_BASE = process.env.DINAMIK_BASE || 'https://dinamikapp-api.dinamik.online'
const API_KEY = process.env.DINAMIK_APIKEY
const SECRET_KEY = process.env.DINAMIK_SECRETKEY
const PROXY_URL = process.env.DINAMIK_PROXY_URL

async function main() {
  console.log('[dinamik] Fetching brand list from API...')
  console.log(`Base: ${DINAMIK_BASE}`)
  console.log(`Proxy: ${PROXY_URL ? 'configured' : 'none'}`)

  const url = `${DINAMIK_BASE}/api/Dnmk_Customer/getBrandList`

  const fetchOptions: any = {
    method: 'GET',
    headers: {
      ApiKey: API_KEY || '',
      SecretKey: SECRET_KEY || ''
    }
  }

  if (PROXY_URL) {
    const dispatcher = new ProxyAgent({
      uri: PROXY_URL,
      connect: { rejectUnauthorized: false }
    })
    fetchOptions.dispatcher = dispatcher
  } else {
    fetchOptions.dispatcher = new Agent({
      connect: { rejectUnauthorized: false }
    })
  }

  const res = await undiciFetch(url, fetchOptions)

  if (!res.ok) {
    const body = await res.text()
    console.error(`HTTP ${res.status}: ${body}`)
    process.exit(1)
  }

  const data = await res.json()
  const brands = Array.isArray(data) ? data : []

  console.log(`\nTotal brands: ${brands.length}`)
  console.log('\nAll brands:')
  brands.forEach((b: any, i: number) => {
    const name = b.brand || b.Brand || b.name || b.Name || JSON.stringify(b)
    console.log(`  ${i + 1}. ${name}`)
  })
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})