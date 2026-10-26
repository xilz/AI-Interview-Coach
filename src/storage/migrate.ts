import { createInterview, getInterview, updateInterview } from './db.ts'
import type { Interview } from './types.ts'

const MIGRATION_KEY = 'interviewIndexedDbMigrationV1'
const validLegacy = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.transcript === 'string' && !!item.transcript.trim() && typeof item.role === 'string' && typeof item.round === 'string' && typeof item.company === 'string'
}

export async function migrateLegacyInterview(storage: Storage = sessionStorage): Promise<Interview | undefined> {
  if (storage.getItem(MIGRATION_KEY) === 'complete') return undefined
  const rawData = storage.getItem('interviewData')
  const rawAnalysis = storage.getItem('interviewAnalysis')
  if (!rawData && !rawAnalysis) return undefined
  try {
    const parsedData = rawData ? JSON.parse(rawData) : undefined
    let parsedAnalysis: unknown
    if (rawAnalysis) {
      try { parsedAnalysis = JSON.parse(rawAnalysis) } catch { parsedAnalysis = undefined }
    }
    const candidate = validLegacy(parsedData) ? parsedData : parsedAnalysis
    if (!validLegacy(candidate)) throw new Error('Legacy interview data has an invalid format.')
    const analysisValue = parsedAnalysis && typeof parsedAnalysis === 'object' ? (parsedAnalysis as Record<string, unknown>).analysis : undefined
    const hasAnalysis = analysisValue !== null && typeof analysisValue === 'object'
    const id = typeof candidate.id === 'string' ? candidate.id : 'legacy-' + (await digest(candidate.transcript as string))
    const now = new Date().toISOString()
    const existing = await getInterview(id)
    const record: Interview = { id, filename: typeof candidate.filename === 'string' ? candidate.filename : undefined, role: candidate.role as string, round: candidate.round as string, company: candidate.company as string, jd: typeof candidate.jd === 'string' ? candidate.jd : undefined, transcript: candidate.transcript as string, analysis: hasAnalysis ? analysisValue as Interview['analysis'] : existing?.analysis, status: hasAnalysis ? 'analyzed' : existing?.status === 'analyzed' ? 'analyzed' : 'transcribed', createdAt: existing?.createdAt ?? now, updatedAt: now }
    if (existing) {
      if (existing.status === 'analyzed' && existing.analysis) {
        storage.setItem(MIGRATION_KEY, 'complete')
        return existing
      }
      await updateInterview({ ...existing, ...record, analysis: hasAnalysis ? analysisValue as Interview['analysis'] : existing.analysis, status: hasAnalysis ? 'analyzed' : existing.status, createdAt: existing.createdAt })
    }
    else await createInterview(record)
    const confirmed = await getInterview(id)
    if (!confirmed || confirmed.transcript !== record.transcript) throw new Error('Could not confirm migrated interview.')
    storage.setItem(MIGRATION_KEY, 'complete')
    return confirmed
  } catch (error) { throw error }
}

async function digest(value: string) {
  if (globalThis.crypto?.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return [...value].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16)
}
