/**
 * S21.6 — ScheduledReport Zod schema for validation
 */
import { z } from 'zod'

export const scheduledReportSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  schedule: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM format')
  }),
  outputFormat: z.enum(['text', 'chart', 'excel', 'pdf']),
  delivery: z.enum(['save', 'open', 'notify']),
  enabled: z.boolean()
})

export const scheduledReportListSchema = z.array(scheduledReportSchema)

export type ScheduledReportSchema = z.infer<typeof scheduledReportSchema>
