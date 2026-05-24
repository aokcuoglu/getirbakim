import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/supplier-matching/dinamik-parcatedarik/manual-match', '/admin/eslestirme/models/manual-match')
  return NextResponse.redirect(url, 307)
}
