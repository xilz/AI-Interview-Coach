import { updateInterview } from './db.ts'
import type { Interview, InterviewAnalysis } from './types.ts'

export class InterviewPersistenceError extends Error {
  constructor(cause: unknown) {
    super(`Analysis completed, but saving it to local history failed: ${cause instanceof Error ? cause.message : 'local storage error'}`, { cause })
    this.name = 'InterviewPersistenceError'
  }
}

export async function persistAnalysis(record: Interview, analysis: InterviewAnalysis): Promise<Interview> {
  const updated = { ...record, analysis, status: 'analyzed' as const, error: undefined, updatedAt: new Date().toISOString() }
  try { await updateInterview(updated); return updated } catch (error) { throw new InterviewPersistenceError(error) }
}
