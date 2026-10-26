import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import {
  closeInterviewDatabaseForTests,
  createInterview,
  deleteInterview,
  getCoachMessages,
  getInterview,
  listInterviews,
  saveCoachMessages,
  updateInterview,
} from '../src/storage/db.ts'
import { migrateLegacyInterview } from '../src/storage/migrate.ts'
import { persistTranscribedInterview } from '../src/storage/upload.ts'
import { InterviewPersistenceError, persistAnalysis } from '../src/storage/analysis.ts'
import { loadInterviewHistory, loadInterviewReview, shouldSkipAnalysis } from '../src/storage/recovery.ts'

const migrationKey = 'interviewIndexedDbMigrationV1'
const originalIndexedDB = globalThis.indexedDB
const interview = (id = 'interview-1') => ({
  id, role: 'Engineer', round: 'Technical', company: 'Example', transcript: 'I built a service.',
  status: 'transcribed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const memoryStorage = (values = {}) => {
  const map = new Map(Object.entries(values))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

afterEach(async () => {
  globalThis.indexedDB = originalIndexedDB
  await closeInterviewDatabaseForTests()
})

test('Interview supports create, read, update and delete', async () => {
  await createInterview(interview())
  assert.equal((await getInterview('interview-1')).role, 'Engineer')
  await updateInterview({ ...interview(), role: 'Senior Engineer', updatedAt: '2026-01-02T00:00:00.000Z' })
  assert.equal((await getInterview('interview-1')).role, 'Senior Engineer')
  assert.equal((await listInterviews()).length, 1)
  await deleteInterview('interview-1')
  assert.equal(await getInterview('interview-1'), undefined)
})

test('only a non-empty successful transcript creates an interview record', async () => {
  await assert.rejects(persistTranscribedInterview({ ...interview('empty-transcript'), transcript: '' }), /without a successful transcript/)
  assert.equal((await listInterviews()).length, 0)
  await persistTranscribedInterview(interview('uploaded-success'))
  assert.equal((await listInterviews()).map((item) => item.id).join(','), 'uploaded-success')
})

test('analysis persistence failure is reported separately without claiming it was saved', async () => {
  const complete = { ...interview('model-succeeded'), analysis: { qa_analysis: [] } }
  globalThis.indexedDB = { open() { throw new Error('simulated quota failure') } }
  await assert.rejects(persistAnalysis(interview('model-succeeded'), complete.analysis), (error) => {
    assert.ok(error instanceof InterviewPersistenceError)
    assert.match(error.message, /Analysis completed, but saving it to local history failed/)
    return true
  })
  globalThis.indexedDB = originalIndexedDB
  assert.equal(await getInterview('model-succeeded'), undefined)
})

test('Coach messages are queried by interviewId and cascade-delete with their interview', async () => {
  await createInterview(interview('interview-a'))
  await createInterview(interview('interview-b'))
  await saveCoachMessages([
    { id: 'a-user', interviewId: 'interview-a', role: 'user', content: 'Question A', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b-user', interviewId: 'interview-b', role: 'user', content: 'Question B', createdAt: '2026-01-01T00:00:00.000Z' },
  ])
  assert.deepEqual((await getCoachMessages('interview-a')).map((message) => message.id), ['a-user'])
  await deleteInterview('interview-a')
  assert.deepEqual(await getCoachMessages('interview-a'), [])
  assert.equal((await getCoachMessages('interview-b'))[0].interviewId, 'interview-b')
})

test('legacy migration is idempotent and keeps interview and Coach IDs associated', async () => {
  const storage = memoryStorage({ interviewData: JSON.stringify({ ...interview('legacy-fixed'), filename: 'call.wav' }) })
  const first = await migrateLegacyInterview(storage)
  const second = await migrateLegacyInterview(storage)
  assert.equal(first.id, 'legacy-fixed')
  assert.equal(second, undefined)
  assert.equal((await listInterviews()).filter((item) => item.id === 'legacy-fixed').length, 1)
  await saveCoachMessages([{ id: 'legacy-msg', interviewId: first.id, role: 'user', content: 'Follow up', createdAt: '2026-01-01T00:00:00.000Z' }])
  assert.equal((await getCoachMessages(first.id))[0].interviewId, first.id)
  assert.equal(first.status, 'transcribed')
  assert.equal(first.analysis, undefined)
  assert.equal(storage.getItem(migrationKey), 'complete')
})

test('migration write failure preserves legacy data and retries without a completion marker', async () => {
  const storage = memoryStorage({ interviewData: JSON.stringify(interview('retryable')) })
  globalThis.indexedDB = { open() { throw new Error('simulated IndexedDB open failure') } }
  await assert.rejects(migrateLegacyInterview(storage), /simulated IndexedDB open failure/)
  assert.equal(storage.getItem('interviewData'), JSON.stringify(interview('retryable')))
  assert.equal(storage.getItem(migrationKey), null)
  globalThis.indexedDB = originalIndexedDB
  const migrated = await migrateLegacyInterview(storage)
  assert.equal(migrated.id, 'retryable')
  assert.equal(storage.getItem(migrationKey), 'complete')
})

test('malformed or incomplete analysis never replaces a valid existing analysis', async () => {
  const existing = { ...interview('protected'), status: 'analyzed', analysis: { qa_analysis: [{ answer: 'kept' }] } }
  await createInterview(existing)
  const storage = memoryStorage({
    interviewData: JSON.stringify(interview('protected')),
    interviewAnalysis: '{broken json',
  })
  const migrated = await migrateLegacyInterview(storage)
  assert.deepEqual(migrated.analysis, existing.analysis)
  assert.equal(migrated.status, 'analyzed')
  assert.deepEqual((await getInterview('protected')).analysis, existing.analysis)
})

test('History loader returns persisted interviews and sees completed analysis updates', async () => {
  await createInterview(interview('history-result'))
  await updateInterview({ ...interview('history-result'), analysis: { qa_analysis: [{ question: 'Q' }] }, status: 'analyzed', updatedAt: '2026-02-01T00:00:00.000Z' })
  const history = await loadInterviewHistory()
  assert.equal(history[0].id, 'history-result')
  assert.equal(history[0].status, 'analyzed')
  assert.deepEqual(history[0].analysis.qa_analysis, [{ question: 'Q' }])
})

test('valid interview ID restores its persisted record', async () => {
  await createInterview(interview('restore-valid'))
  assert.deepEqual(await loadInterviewReview('restore-valid'), interview('restore-valid'))
})

test('missing or invalid interview ID rejects instead of leaving review loading', async () => {
  await assert.rejects(loadInterviewReview('missing-id'), /could not be found/)
  await assert.rejects(loadInterviewReview(undefined), /link is invalid/)
  await assert.rejects(loadInterviewReview('../bad'), /link is invalid/)
})

test('completed interview restoration is identified as not needing model analysis', async () => {
  const complete = { ...interview('already-done'), status: 'analyzed', analysis: { qa_analysis: [] } }
  await createInterview(complete)
  const restored = await loadInterviewReview('already-done')
  assert.equal(shouldSkipAnalysis(restored), true)
  assert.equal(shouldSkipAnalysis(interview('not-done')), false)
})
