import { ApiError, NetworkError } from '../api/errors'

/** Where an error happened; the same server code can deserve different wording (e.g. NOT_FOUND). */
export type ErrorContext = 'load' | 'apply' | 'confirm' | 'cancel' | 'createClass'

/** Primary action labels (BRD §4.1): Bangla first, as in the approved design. */
export const ACTION_LABELS = {
  apply: 'আবেদন করুন',
  appliedAlready: 'আবেদন করা হয়েছে',
  pay: 'ভর্তি ফি দিন',
  cancel: 'বাতিল',
} as const

export const GENERIC_MESSAGE = 'Something went wrong. Please try again.'
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again later.'
export const OFFLINE_MESSAGE =
  "We can't reach the admission server. Please check your internet connection; we will keep retrying."
export const TIMEOUT_MESSAGE = 'The server is taking too long to respond. Please try again in a moment.'

/** Server code -> friendly text. Codes mirror backend ErrorCodes.cs. */
const BY_CODE: Record<string, string> = {
  SEATS_FULL: 'Sorry, all seats in this class are taken. Please try another class or check back later.',
  ALREADY_APPLIED: 'You already have an active application for this class.',
  HOLD_EXPIRED:
    "Your seat hold has expired, so admission can't be confirmed. Please apply again if seats are available.",
  HOLD_NOT_ACTIVE: 'This application was cancelled and can no longer be confirmed.',
  CANNOT_CANCEL_CONFIRMED:
    "This admission is already confirmed and can't be cancelled online. Please contact the school office.",
  DUPLICATE_CLASS_NAME: 'A class with this name already exists. Please choose a different name.',
  INVALID_STUDENT_ID: 'Please enter your 17-digit student registration number (digits 0–9 only).',
  SERVICE_UNAVAILABLE: 'The admission service is temporarily unavailable. Please try again in a moment.',
  INTERNAL_ERROR: SERVER_ERROR_MESSAGE,
  METHOD_NOT_ALLOWED: GENERIC_MESSAGE,
  UNSUPPORTED_MEDIA_TYPE: GENERIC_MESSAGE,
  PAYLOAD_TOO_LARGE: 'The information you entered is too large.',
  CONFLICT: 'This action conflicts with the current state. The page has been refreshed; please try again.',
}

const NOT_FOUND: Record<ErrorContext, string> = {
  load: 'The requested information was not found.',
  apply: 'This class no longer exists. The list has been refreshed.',
  confirm: "We couldn't find this application for your registration number. The list has been refreshed.",
  cancel: "We couldn't find this application for your registration number. The list has been refreshed.",
  createClass: GENERIC_MESSAGE,
}

const VALIDATION_FALLBACK = 'Please check the information you entered and try again.'

/**
 * Turns any thrown value into text a guardian can act on. Never exposes status codes, raw JSON or stack traces.
 * Server `detail` is used only for 4xx validation-style errors, where the backend writes it for end users.
 */
export function messageFor(error: unknown, context: ErrorContext = 'load'): string {
  if (error instanceof NetworkError) return error.kind === 'timeout' ? TIMEOUT_MESSAGE : OFFLINE_MESSAGE

  if (error instanceof ApiError) {
    if (error.code === 'NOT_FOUND') return NOT_FOUND[context]
    if (error.code === 'VALIDATION_FAILED') return error.detail ?? VALIDATION_FALLBACK
    const known = BY_CODE[error.code]
    if (known) return known
    if (error.status >= 500) return SERVER_ERROR_MESSAGE
    return error.detail ?? GENERIC_MESSAGE
  }

  return GENERIC_MESSAGE
}

/** Machine code of an error, or undefined for network/unknown errors. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

/** True when retrying the same request later may succeed (server down/overloaded/slow). */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true
  return error instanceof ApiError && (error.status === 503 || error.status === 502 || error.status === 504)
}

/** The server's state may have changed under us (409/404): refetch lists so the UI converges to the truth. */
export function shouldRefetchAfter(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 404)
}
