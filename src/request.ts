export class RequestTimeoutError extends Error {
  constructor(label: string) { super(`${label} timed out. Please try again.`); this.name = 'RequestTimeoutError' }
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, label: string) {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal })
    return response
  } catch (error) {
    if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') throw new RequestTimeoutError(label)
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(`${label} failed due to a network error. Check your connection and try again.`, { cause: error })
  }
}
