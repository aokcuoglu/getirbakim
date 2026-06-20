import { autoMatchDpprdProducts } from '../lib/admin/dpprd-auto-match'

async function main() {
  console.log('Starting product auto-match...')
  const stats = await autoMatchDpprdProducts({
    apply: true,
    onProgress: (msg) => console.log(msg)
  })
  console.log('Done:', JSON.stringify(stats, null, 2))
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
