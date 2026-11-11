import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient, onServerTime } from '../api/client'
import { ApiError, NetworkError } from '../api/errors'
import { BASE, jsonResponse, mockFetch, problem } from './fetchMock'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const client = createApiClient({ baseUrl: BASE, timeoutMs: 1000 })

describe('api client: requests', () => {
  it('sends X-Student-Id only when a student id is given', async () => {
    const { calls } = mockFetch(() => jsonResponse(200, []))
    await client.request('/classes')
    await client.request('/me/holds', { studentId: '20152691234567890' })
    expect(calls[0]!.headers.has('X-Student-Id')).toBe(false)
    expect(calls[1]!.headers.get('X-Student-Id')).toBe('20152691234567890')
  })

  it('serialises JSON bodies with a content type and none without a body', async () => {
    const { calls } = mockFetch(() => jsonResponse(201, { id: 'c_1' }))
    await client.request('/classes', { method: 'POST', body: { name: 'A', totalSeats: 3 } })
    await client.request('/classes/c_1/holds', { method: 'POST', studentId: '20152691234567890' })
    expect(calls[0]!.headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(calls[0]!.body!)).toEqual({ name: 'A', totalSeats: 3 })
    expect(calls[1]!.headers.has('Content-Type')).toBe(false)
    expect(calls[1]!.body).toBeUndefined()
  })

  it('joins base URL and path, tolerating trailing slashes', async () => {
    const { calls } = mockFetch(() => jsonResponse(200, []))
    await createApiClient({ baseUrl: `${BASE}//` }).request('/classes')
    expect(calls[0]!.url).toBe(`${BASE}/classes`)
  })

  it('returns parsed JSON for 2xx and undefined for 204', async () => {
    mockFetch((c) => (c.method === 'DELETE' ? jsonResponse(204) : jsonResponse(200, { ok: true })))
    expect(await client.request('/x')).toEqual({ ok: true })
    expect(await client.request('/x', { method: 'DELETE' })).toBeUndefined()
  })
})

describe('api client: errors', () => {
  it('parses problem+json into ApiError with status, code and detail', async () => {
    mockFetch(() => problem(409, 'SEATS_FULL', 'All taken.'))
    const err = await client.request('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'SEATS_FULL', detail: 'All taken.' })
  })

  it('falls back to a status-derived code for non-JSON error bodies (e.g. a proxy 502 page)', async () => {
    mockFetch(() => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
    const err = await client.request('/x').catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 502, code: 'INTERNAL_ERROR', detail: undefined })
  })

  it('handles an empty error body and JSON that is not an object', async () => {
    mockFetch((c) => (c.url.endsWith('/a') ? new Response(null, { status: 503 }) : jsonResponse(404, 'nope')))
    expect(await client.request('/a').catch((e: unknown) => e)).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' })
    expect(await client.request('/b').catch((e: unknown) => e)).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('reports an unreadable 2xx body as an ApiError instead of crashing', async () => {
    mockFetch(() => new Response('not json', { status: 200 }))
    expect(await client.request('/x').catch((e: unknown) => e)).toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('maps a rejected fetch (server down, DNS, CORS) to NetworkError offline', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const err = await client.request('/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect(err).toMatchObject({ kind: 'offline' })
  })

  it('times out slow requests with NetworkError timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const pending = client.request('/x').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await pending).toMatchObject({ name: 'NetworkError', kind: 'timeout' })
  })

  it('lets caller cancellation through as an abort, not as a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const caller = new AbortController()
    const pending = client.request('/x', { signal: caller.signal }).catch((e: unknown) => e)
    caller.abort()
    const err = await pending
    expect(err).not.toBeInstanceOf(NetworkError)
    expect((err as Error).name).toBe('AbortError')
  })
})

describe('api client: server time', () => {
  it('reports the HTTP Date header to listeners and ignores a missing or invalid one', async () => {
    const seen: number[] = []
    const off = onServerTime((t) => seen.push(t))
    mockFetch((c) =>
      c.url.endsWith('/a')
        ? jsonResponse(200, [], { Date: 'Wed, 11 Nov 2026 04:10:00 GMT' })
        : jsonResponse(200, [], { Date: 'garbage' }),
    )
    await client.request('/a')
    await client.request('/b')
    off()
    await client.request('/a')
    expect(seen).toEqual([Date.UTC(2026, 10, 11, 4, 10, 0)])
  })
})

describe('status → code fallback (when an error response carries no code)', () => {
  it.each([
    [400, 'VALIDATION_FAILED'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [503, 'SERVICE_UNAVAILABLE'],
    [500, 'INTERNAL_ERROR'],
    [504, 'INTERNAL_ERROR'],
    [418, 'ERROR'],
  ])('HTTP %i → %s', async (status, code) => {
    mockFetch(() => new Response(null, { status }))
    expect(await client.request('/x').catch((e: unknown) => e)).toMatchObject({ status, code })
  })
})
