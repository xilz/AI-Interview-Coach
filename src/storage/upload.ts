import { createInterview } from './db.ts'
import type { Interview } from './types.ts'

export async function persistTranscribedInterview(record: Interview): Promise<Interview> {
  if (typeof record.transcript !== 'string' || !record.transcript.trim()) {
    throw new Error('Cannot create an interview without a successful transcript.')
  }
  await createInterview(record)
  return record
}
