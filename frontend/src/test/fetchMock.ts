import { vi } from 'vitest'

export const BASE = 'http://api.test'

export function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  if (body === undefined) return new Response(null, { status, headers })
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** RFC 7807 problem+json like the backend sends. */
export function problem(status: number, code: string, detail = 'Server detail text.'): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, detail, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

export interface RecordedCall {
  url: string
  method: string
  headers: Headers
  body: string | undefined
}

/** Replaces global fetch. The handler receives each call and returns a Response (or throws/rejects). */
export function mockFetch(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    calls.push(call)
    return handler(call)
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}
