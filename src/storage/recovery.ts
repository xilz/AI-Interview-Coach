import { getInterview, listInterviews } from './db.ts'
import type { Interview } from './types.ts'

export async function loadInterviewHistory(): Promise<Interview[]> {
  return listInterviews()
}

export async function loadInterviewReview(id: string | undefined): Promise<Interview> {
  if (!id || !/^[\w-]+$/.test(id)) throw new Error('This interview link is invalid.')
  const record = await getInterview(id)
  if (!record) throw new Error('This interview could not be found in local history.')
  return record
}

export function shouldSkipAnalysis(record: Interview | undefined): boolean {
  return record?.status === 'analyzed' && !!record.analysis
}
