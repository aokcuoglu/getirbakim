import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })
import { db } from '../lib/db'

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

  console.log('[basbug] Fetching DovizBilgisiGetir...')
  const res = await fetch(
    `${BASBUG_BASE}/material/DovizBilgisiGetir?FirmaAdi=${FIRMA_ADI}`,
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
  const rates = data.dovizListesi || []

  console.log(`\nTotal rates: ${rates.length}`)
  rates.forEach((r: any) => {
    console.log(`  ${r.dovizCinsi}: alis=${r.alis} satis=${r.satis}`)
  })

  // Write to DB
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  console.log('\n[basbug] Writing rates to DB...')
  for (const rate of rates) {
    const dovizCinsi = rate.dovizCinsi?.trim()
    if (!dovizCinsi) continue

    await db.$executeRaw`
      INSERT INTO catalog.supplier_basbug_rates (doviz_cinsi, alis, satis, kaynak, tarih)
      VALUES (${dovizCinsi}, ${rate.alis}::numeric, ${rate.satis}::numeric, 'BASBUG', ${today})
      ON CONFLICT (doviz_cinsi, kaynak, tarih) DO UPDATE SET
        alis = EXCLUDED.alis,
        satis = EXCLUDED.satis
    `
    console.log(`  ✓ ${dovizCinsi}: ${rate.alis} / ${rate.satis}`)
  }

  console.log('\n[basbug] Rates written to DB successfully')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})