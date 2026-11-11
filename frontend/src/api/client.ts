import { ApiError, NetworkError, errorFromResponse } from './errors'

export const STUDENT_ID_HEADER = 'X-Student-Id'
export const DEFAULT_BASE_URL = 'http://localhost:8080'
export const DEFAULT_TIMEOUT_MS = 10_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  /** Sent as the X-Student-Id header when given. */
  studentId?: string
  /** JSON-serialised request body. */
  body?: unknown
  /** Caller cancellation (e.g. TanStack Query). Aborting rejects with the platform's AbortError. */
  signal?: AbortSignal
}

export interface ApiClientOptions {
  baseUrl?: string
  timeoutMs?: number
}

type ServerTimeListener = (serverTimeMs: number) => void
const serverTimeListeners = new Set<ServerTimeListener>()

/**
 * Subscribes to the server time carried by the HTTP `Date` header of every response (used for clock-skew
 * correction, step 6). Browsers only expose it cross-origin if the API lists it in Access-Control-Expose-Headers;
 * when it is hidden the listener is simply never called.
 */
export function onServerTime(listener: ServerTimeListener): () => void {
  serverTimeListeners.add(listener)
  return () => serverTimeListeners.delete(listener)
}

function reportServerTime(response: Response): void {
  const header = response.headers.get('Date')
  const parsed = header ? Date.parse(header) : NaN
  if (!Number.isNaN(parsed)) serverTimeListeners.forEach((l) => l(parsed))
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.studentId !== undefined) headers[STUDENT_ID_HEADER] = opts.studentId
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

    // One controller covers both our timeout and the caller's cancellation.
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onCallerAbort = () => controller.abort(opts.signal?.reason)
    if (opts.signal?.aborted) onCallerAbort()
    else opts.signal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      let response: Response
      try {
        response = await fetch(baseUrl + path, {
          method: opts.method ?? 'GET',
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        })
      } catch (cause) {
        if (timedOut) throw new NetworkError('timeout')
        if (opts.signal?.aborted) throw cause // cancelled by the caller: not a failure to report
        throw new NetworkError('offline')
      }

      reportServerTime(response)

      if (!response.ok) throw await errorFromResponse(response)
      if (response.status === 204) return undefined as T

      try {
        return (await response.json()) as T
      } catch {
        throw new ApiError(response.status, 'INVALID_RESPONSE')
      }
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  return { request }
}

/** The app-wide client. The base URL is fixed at build time from VITE_API_BASE_URL. */
export const api = createApiClient({
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) || DEFAULT_BASE_URL,
})
