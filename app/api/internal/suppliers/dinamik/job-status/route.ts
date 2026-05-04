import { NextRequest, NextResponse } from 'next/server'
import { DinamikJobQueue } from '@/lib/suppliers/dinamik-job-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/internal/suppliers/dinamik/job-status
 * Check status of a sync job
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = request.nextUrl.searchParams.get('id')
  if (!jobId || !/^\d+$/.test(jobId)) {
    return NextResponse.json(
      { error: 'Invalid or missing job ID' },
      { status: 400 }
    )
  }

  try {
    const job = await DinamikJobQueue.getJobStatus(Number(jobId))

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Calculate progress estimate
    const progress = calculateProgress(job)

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      brand: job.brand,
      limitBrands: job.limit_brands,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      errorMessage: job.error_message,
      result: job.result,
      progress,
      duration: job.started_at && job.completed_at
        ? Math.round((job.completed_at.getTime() - job.started_at.getTime()) / 1000)
        : null
    })
  } catch (error) {
    console.error('[JobStatus] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get job status' },
      { status: 500 }
    )
  }
}

/**
 * Calculate estimated progress percentage
 */
function calculateProgress(job: any): number {
  if (job.status === 'PENDING') return 0
  if (job.status === 'COMPLETED') return 100
  if (job.status === 'FAILED') return -1

  // RUNNING - estimate based on time elapsed
  if (job.started_at) {
    const elapsed = Date.now() - job.started_at.getTime()
    const estimatedTotal = job.mode === 'delta' ? 2 * 60 * 1000 : 10 * 60 * 1000 // 2min or 10min
    
    // Cap at 95% until completion
    return Math.min(95, Math.round((elapsed / estimatedTotal) * 100))
  }

  return 0
}
