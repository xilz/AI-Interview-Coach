import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithTimeout, RequestTimeoutError } from '../src/request.ts'

const originalFetch = globalThis.fetch

test('fetchWithTimeout distinguishes timeout from network failure and caller cancellation', async () => {
  try {
    globalThis.fetch = (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const timeoutRequest = fetchWithTimeout('/upload', {}, 10, 'Upload')
    const timeoutAssertion = assert.rejects(timeoutRequest, RequestTimeoutError)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await timeoutAssertion

    globalThis.fetch = async () => { throw new TypeError('offline') }
    await assert.rejects(fetchWithTimeout('/analyze', {}, 1000, 'Analysis'), /network error/)

    const controller = new AbortController()
    globalThis.fetch = (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const pending = fetchWithTimeout('/analyze', { signal: controller.signal }, 1000, 'Analysis')
    controller.abort()
    await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError')
  } finally {
    globalThis.fetch = originalFetch
  }
})
