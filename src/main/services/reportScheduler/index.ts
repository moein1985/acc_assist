/**
 * S21.7 — ReportScheduler service
 * Runs scheduled reports at specified intervals using node-cron-like setInterval approach.
 */
import type { ScheduledReport } from '../../../shared/contracts'
import { scheduledReportListSchema } from './scheduledReportSchema'

export interface ReportSchedulerDeps {
  executeReport: (report: ScheduledReport) => Promise<void>
  getReports: () => ScheduledReport[]
  log: (message: string) => void
}

export class ReportScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map()
  private deps: ReportSchedulerDeps

  constructor(deps: ReportSchedulerDeps) {
    this.deps = deps
  }

  /**
   * Start scheduler — reads reports from settings and schedules active ones
   */
  start(): void {
    this.stopAll()
    const reports = this.deps.getReports()
    const parseResult = scheduledReportListSchema.safeParse(reports)
    if (!parseResult.success) {
      this.deps.log(`ReportScheduler: invalid scheduled reports: ${parseResult.error.issues[0]?.message}`)
      return
    }

    for (const report of parseResult.data) {
      if (!report.enabled) {
        continue
      }
      this.scheduleReport(report)
    }

    this.deps.log(`ReportScheduler: started with ${this.timers.size} active timer(s)`)
  }

  /**
   * Stop all timers
   */
  stopAll(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer)
      this.timers.delete(id)
    }
  }

  /**
   * Schedule a single report based on its frequency
   */
  private scheduleReport(report: ScheduledReport): void {
    const intervalMs = this.computeIntervalMs(report)
    if (intervalMs <= 0) {
      this.deps.log(`ReportScheduler: invalid schedule for report ${report.id}`)
      return
    }

    const timer = setInterval(() => {
      void this.runReport(report)
    }, intervalMs)

    this.timers.set(report.id, timer)
    this.deps.log(`ReportScheduler: scheduled "${report.name}" (${report.schedule.frequency}) every ${intervalMs / 1000}s`)
  }

  /**
   * Run a single report, catching errors
   */
  private async runReport(report: ScheduledReport): Promise<void> {
    try {
      this.deps.log(`ReportScheduler: running "${report.name}"...`)
      await this.deps.executeReport(report)
      this.deps.log(`ReportScheduler: completed "${report.name}"`)
    } catch (error) {
      this.deps.log(`ReportScheduler: error running "${report.name}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Compute interval in milliseconds based on frequency
   */
  private computeIntervalMs(report: ScheduledReport): number {
    switch (report.schedule.frequency) {
      case 'daily':
        return 24 * 60 * 60 * 1000 // 24 hours
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000 // 7 days
      case 'monthly':
        return 30 * 24 * 60 * 60 * 1000 // ~30 days
      default:
        return 0
    }
  }

  /**
   * Check if a report should run now based on its schedule
   */
  static shouldRunNow(report: ScheduledReport, now: Date = new Date()): boolean {
    if (!report.enabled) {
      return false
    }

    const [hours, minutes] = report.schedule.time.split(':').map(Number)
    const currentHours = now.getHours()
    const currentMinutes = now.getMinutes()

    if (currentHours !== hours || currentMinutes !== minutes) {
      return false
    }

    switch (report.schedule.frequency) {
      case 'daily':
        return true
      case 'weekly':
        return now.getDay() === (report.schedule.dayOfWeek ?? 0)
      case 'monthly':
        return now.getDate() === (report.schedule.dayOfMonth ?? 1)
      default:
        return false
    }
  }
}
