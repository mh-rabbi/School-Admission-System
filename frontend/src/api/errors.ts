import type { ProblemBody } from './types'

/** The server answered with an error status. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** The server's human-readable `detail`, if any. Safe to show for 4xx; never shown for 5xx. */
  readonly detail: string | undefined

  constructor(status: number, code: string, detail?: string) {
    super(detail ?? `${status} ${code}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** No usable answer: the server is down/unreachable ('offline') or too slow ('timeout'). */
export class NetworkError extends Error {
  readonly kind: 'offline' | 'timeout'

  constructor(kind: 'offline' | 'timeout') {
    super(kind === 'offline' ? 'Network request failed' : 'Request timed out')
    this.name = 'NetworkError'
    this.kind = kind
  }
}

/** Same fallback the backend uses when it sends no explicit code (ErrorCodes.FromStatus). */
export function codeFromStatus(status: number): string {
  switch (status) {
    case 400: return 'VALIDATION_FAILED'
    case 404: return 'NOT_FOUND'
    case 405: return 'METHOD_NOT_ALLOWED'
    case 409: return 'CONFLICT'
    case 413: return 'PAYLOAD_TOO_LARGE'
    case 415: return 'UNSUPPORTED_MEDIA_TYPE'
    case 503: return 'SERVICE_UNAVAILABLE'
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'
  }
}

/** Builds an ApiError from a non-2xx response. Tolerates non-JSON bodies (proxy pages, empty bodies). */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: ProblemBody | undefined
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object') body = parsed as ProblemBody
  } catch {
    body = undefined
  }
  const code = typeof body?.code === 'string' && body.code ? body.code : codeFromStatus(response.status)
  const detail = typeof body?.detail === 'string' && body.detail ? body.detail : undefined
  return new ApiError(response.status, code, detail)
}
