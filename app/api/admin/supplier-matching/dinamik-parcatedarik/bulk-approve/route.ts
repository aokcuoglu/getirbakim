import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/supplier-matching/dinamik-parcatedarik/bulk-approve', '/admin/eslestirme/models/bulk-approve')
  return NextResponse.redirect(url, 307)
}
