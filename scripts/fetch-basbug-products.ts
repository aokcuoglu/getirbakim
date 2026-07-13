import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

const BASBUG_BASE = process.env.BASBUG_BASE_URL || 'https://api.basbug.com.tr'
const FIRMA_ADI = 'BASBUG'

async function getBasbugToken(): Promise<string> {
  const res = await fetch(`${BASBUG_BASE}/auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kullaniciAdi: process.env.BASBUG_USERNAME,
      parola: process.env.BASBUG_PASSWORD,
      clientID: process.env.BASBUG_CLIENT_ID,
      clientSecret: process.env.BASBUG_CLIENT_SECRET
    })
  })
  if (!res.ok) {
    console.error(`Auth failed: HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }
  const data: any = await res.json()
  return data.token
}

async function main() {
  const token = await getBasbugToken()
  const grupKodu = process.argv[2] || 'PSA'

  console.log(`\n[basbug] Fetching MalzemeleriGetir for group: ${grupKodu}...`)
  const res = await fetch(
    `${BASBUG_BASE}/material/MalzemeleriGetir?FirmaAdi=${FIRMA_ADI}&ListeGrubu=${encodeURIComponent(grupKodu)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
  )

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data: any = await res.json()
  const items = data.malzemeListesi || []

  console.log(`\nTotal products in group ${grupKodu}: ${items.length}`)
  console.log(`\nFirst 10 products (sample):`)
  items.slice(0, 10).forEach((m: any, i: number) => {
    console.log(`  ${i + 1}. no="${m.no}" ac="${m.ac}" uk="${m.uk}" oe="${m.oe}" lf=${m.lf} dc="${m.dc}"`)
  })

  // Brand distribution
  const brands = new Map<string, number>()
  items.forEach((m: any) => {
    const brand = m.uk || 'BİLİNMEYEN'
    brands.set(brand, (brands.get(brand) || 0) + 1)
  })
  console.log(`\nBrand distribution (${brands.size} distinct brands):`)
  Array.from(brands.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([brand, count]) => console.log(`  ${brand}: ${count} products`))
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})