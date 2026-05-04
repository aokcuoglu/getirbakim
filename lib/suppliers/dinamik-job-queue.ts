import { db } from '@/lib/db'
import { runDinamikCatalogSeedJob } from './sync-dinamik'

export interface DinamikJob {
  id: number
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  mode: 'full' | 'delta'
  brand?: string | null
  limit_brands?: number | null
  created_at: Date
  started_at?: Date | null
  completed_at?: Date | null
  error_message?: string | null
  result?: any | null
}

/**
 * Job queue for Dinamik sync operations
 * Runs jobs in background with proper error handling
 */
export class DinamikJobQueue {
  /**
   * Create a new sync job
   */
  static async createJob(input: {
    mode: 'full' | 'delta'
    brand?: string
    limitBrands?: number
  }): Promise<number> {
    const job = await db.dinamik_sync_jobs.create({
      data: {
        status: 'PENDING',
        mode: input.mode,
        brand: input.brand,
        limit_brands: input.limitBrands
      },
      select: { id: true }
    })

    // Schedule job to run in background
    this.scheduleJob(job.id)

    return job.id
  }

  /**
   * Schedule a job to run asynchronously
   */
  private static async scheduleJob(jobId: number): Promise<void> {
    // Use setImmediate to run after response is sent
    setImmediate(async () => {
      try {
        await this.executeJob(jobId)
      } catch (error) {
        console.error(`[DinamikJobQueue] Fatal error for job #${jobId}:`, error)
        await this.failJob(jobId, error instanceof Error ? error.message : 'Unknown error')
      }
    })
  }

  /**
   * Execute a single job
   */
  private static async executeJob(jobId: number): Promise<void> {
    // Update status to RUNNING
    await db.dinamik_sync_jobs.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        started_at: new Date()
      }
    })

    try {
      // Fetch job details
      const job = await db.dinamik_sync_jobs.findUnique({
        where: { id: jobId }
      })

      if (!job) {
        throw new Error(`Job #${jobId} not found`)
      }

      // Run the actual sync
      const result = await runDinamikCatalogSeedJob({
        mode: job.mode as 'full' | 'delta',
        brand: job.brand ?? undefined,
        limitBrands: job.limit_brands ?? undefined,
        triggerType: 'SCHEDULED'
      })

      // Mark as COMPLETED
      await db.dinamik_sync_jobs.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
          result: {
            runId: result.runId,
            brandCount: result.brandCount,
            totalCount: result.totalCount,
            successCount: result.successCount,
            failedCount: result.failedCount,
            offerCount: result.offerCount
          }
        }
      })

      console.log(`[DinamikJobQueue] Job #${jobId} completed:`, {
        status: result.status,
        total: result.totalCount,
        success: result.successCount
      })
    } catch (error) {
      await this.failJob(jobId, error instanceof Error ? error.message : String(error))
      throw error // Re-throw for caller to handle
    }
  }

  /**
   * Mark a job as failed
   */
  private static async failJob(jobId: number, errorMessage: string): Promise<void> {
    await db.dinamik_sync_jobs.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completed_at: new Date(),
        error_message: errorMessage
      }
    })

    console.error(`[DinamikJobQueue] Job #${jobId} failed:`, errorMessage)
  }

  /**
   * Get job status
   */
  static async getJobStatus(jobId: number): Promise<DinamikJob | null> {
    const row = await db.dinamik_sync_jobs.findUnique({
      where: { id: jobId }
    })
    if (!row) return null
    return {
      ...row,
      status: row.status as DinamikJob['status'],
      mode: row.mode as DinamikJob['mode']
    }
  }

  /**
   * Get recent jobs
   */
  static async getRecentJobs(limit = 20): Promise<DinamikJob[]> {
    const rows = await db.dinamik_sync_jobs.findMany({
      orderBy: { created_at: 'desc' },
      take: limit
    })
    return rows.map((row) => ({
      ...row,
      status: row.status as DinamikJob['status'],
      mode: row.mode as DinamikJob['mode']
    }))
  }

  /**
   * Clean up old completed jobs (older than 7 days)
   */
  static async cleanup(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    
    const result = await db.dinamik_sync_jobs.deleteMany({
      where: {
        status: 'COMPLETED',
        completed_at: { lt: sevenDaysAgo }
      }
    })

    return result.count
  }
}
