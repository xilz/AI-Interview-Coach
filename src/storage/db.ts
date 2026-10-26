import { deleteDB, openDB, type IDBPDatabase } from 'idb'
import type { CoachMessage, Interview } from './types'

const DB_NAME = 'ai-interview-coach'
const DB_VERSION = 1
const INTERVIEWS = 'interviews'
const MESSAGES = 'coachMessages'
type Schema = { interviews: Interview; coachMessages: CoachMessage }
let dbPromise: Promise<IDBPDatabase<Schema>> | undefined

function database() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(INTERVIEWS)) db.createObjectStore(INTERVIEWS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(MESSAGES)) {
        const store = db.createObjectStore(MESSAGES, { keyPath: 'id' })
        store.createIndex('interviewId', 'interviewId')
      }
    },
    blocked() { dbPromise = undefined },
  }).catch((error) => { dbPromise = undefined; throw error })
  return dbPromise
}

export async function createInterview(interview: Interview) { const db = await database(); await db.add(INTERVIEWS, interview); return interview }
export async function getInterview(id: string) { return (await database()).get(INTERVIEWS, id) }
export async function updateInterview(interview: Interview) { const db = await database(); await db.put(INTERVIEWS, interview); return interview }
export async function listInterviews() { return (await database()).getAll(INTERVIEWS).then((items) => items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) }
export async function saveCoachMessages(messages: CoachMessage[]) { const db = await database(); const tx = db.transaction(MESSAGES, 'readwrite'); for (const message of messages) await tx.store.put(message); await tx.done }
export async function getCoachMessages(interviewId: string) { return (await database()).getAllFromIndex(MESSAGES, 'interviewId', interviewId).then((messages) => messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) }
export async function deleteCoachMessages(interviewId: string) { const db = await database(); const tx = db.transaction(MESSAGES, 'readwrite'); const keys = await tx.store.index('interviewId').getAllKeys(interviewId); await Promise.all(keys.map((key) => tx.store.delete(key))); await tx.done }
export async function deleteInterview(id: string) { const db = await database(); const tx = db.transaction([INTERVIEWS, MESSAGES], 'readwrite'); const keys = await tx.objectStore(MESSAGES).index('interviewId').getAllKeys(id); await Promise.all(keys.map((key) => tx.objectStore(MESSAGES).delete(key))); await tx.objectStore(INTERVIEWS).delete(id); await tx.done }
export async function closeInterviewDatabaseForTests() { await dbPromise?.then((db) => db.close()); dbPromise = undefined; await deleteDB(DB_NAME) }
