import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import {
  ACTION_LABELS,
  GENERIC_MESSAGE,
  OFFLINE_MESSAGE,
  SERVER_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  errorCode,
  isTransient,
  messageFor,
  shouldRefetchAfter,
} from '../i18n/messages'

describe('messageFor: every backend error code has friendly text', () => {
  const cases: [number, string][] = [
    [409, 'SEATS_FULL'],
    [409, 'ALREADY_APPLIED'],
    [409, 'HOLD_EXPIRED'],
    [409, 'HOLD_NOT_ACTIVE'],
    [409, 'CANNOT_CANCEL_CONFIRMED'],
    [409, 'DUPLICATE_CLASS_NAME'],
    [400, 'INVALID_STUDENT_ID'],
    [400, 'VALIDATION_FAILED'],
    [404, 'NOT_FOUND'],
    [503, 'SERVICE_UNAVAILABLE'],
    [500, 'INTERNAL_ERROR'],
    [405, 'METHOD_NOT_ALLOWED'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [409, 'CONFLICT'],
  ]

  // VALIDATION_FAILED intentionally echoes the server's end-user `detail`; it is covered by its own test below.
  const leakCases = cases.filter(([, code]) => code !== 'VALIDATION_FAILED')

  it.each(leakCases)('%i %s -> readable sentence; raw detail, codes and JSON never shown', (status, code) => {
    const text = messageFor(new ApiError(status, code, 'RAW SERVER DETAIL {"x":1}'), 'apply')
    expect(text).not.toContain('RAW SERVER DETAIL')
    expect(text.length).toBeGreaterThan(10)
    expect(text).not.toContain(code)
    expect(text).not.toMatch(/[{}]|\b(4|5)\d\d\b|Exception|stack/i)
  })

  it('uses wording specific to the situation', () => {
    expect(messageFor(new ApiError(409, 'SEATS_FULL'))).toMatch(/all seats/i)
    expect(messageFor(new ApiError(409, 'HOLD_EXPIRED'))).toMatch(/expired/i)
    expect(messageFor(new ApiError(409, 'CANNOT_CANCEL_CONFIRMED'))).toMatch(/school office/i)
    expect(messageFor(new ApiError(409, 'DUPLICATE_CLASS_NAME'))).toMatch(/already exists/i)
    expect(messageFor(new ApiError(400, 'INVALID_STUDENT_ID'))).toMatch(/17-digit/i)
  })

  it('words NOT_FOUND by context', () => {
    const nf = new ApiError(404, 'NOT_FOUND')
    expect(messageFor(nf, 'apply')).toMatch(/class/i)
    expect(messageFor(nf, 'confirm')).toMatch(/application/i)
    expect(messageFor(nf, 'cancel')).toMatch(/application/i)
  })

  it('shows the backend validation detail (written for end users) for VALIDATION_FAILED', () => {
    expect(messageFor(new ApiError(400, 'VALIDATION_FAILED', 'Class name is required.'), 'createClass')).toBe(
      'Class name is required.',
    )
    expect(messageFor(new ApiError(400, 'VALIDATION_FAILED'), 'createClass')).toMatch(/check the information/i)
  })

  it('maps network failures to server-down / timeout messages', () => {
    expect(messageFor(new NetworkError('offline'))).toBe(OFFLINE_MESSAGE)
    expect(messageFor(new NetworkError('timeout'))).toBe(TIMEOUT_MESSAGE)
  })

  it('never leaks the detail of an unknown 5xx, but may show an unknown 4xx detail', () => {
    expect(messageFor(new ApiError(500, 'WEIRD', 'db password is x'))).toBe(SERVER_ERROR_MESSAGE)
    expect(messageFor(new ApiError(418, 'TEAPOT', 'I am a teapot'))).toBe('I am a teapot')
    expect(messageFor(new ApiError(418, 'TEAPOT'))).toBe(GENERIC_MESSAGE)
  })

  it('falls back to a generic message for non-API errors', () => {
    expect(messageFor(new Error('boom'))).toBe(GENERIC_MESSAGE)
    expect(messageFor('string')).toBe(GENERIC_MESSAGE)
    expect(messageFor(undefined)).toBe(GENERIC_MESSAGE)
  })
})

describe('error helpers', () => {
  it('errorCode', () => {
    expect(errorCode(new ApiError(409, 'SEATS_FULL'))).toBe('SEATS_FULL')
    expect(errorCode(new NetworkError('offline'))).toBeUndefined()
  })

  it('isTransient: network, 502/503/504 yes; business errors no', () => {
    expect(isTransient(new NetworkError('offline'))).toBe(true)
    expect(isTransient(new NetworkError('timeout'))).toBe(true)
    expect(isTransient(new ApiError(503, 'SERVICE_UNAVAILABLE'))).toBe(true)
    expect(isTransient(new ApiError(502, 'INTERNAL_ERROR'))).toBe(true)
    expect(isTransient(new ApiError(409, 'SEATS_FULL'))).toBe(false)
    expect(isTransient(new ApiError(500, 'INTERNAL_ERROR'))).toBe(false)
  })

  it('shouldRefetchAfter: 404/409 mean server state changed', () => {
    expect(shouldRefetchAfter(new ApiError(409, 'HOLD_EXPIRED'))).toBe(true)
    expect(shouldRefetchAfter(new ApiError(404, 'NOT_FOUND'))).toBe(true)
    expect(shouldRefetchAfter(new ApiError(400, 'INVALID_STUDENT_ID'))).toBe(false)
    expect(shouldRefetchAfter(new NetworkError('offline'))).toBe(false)
  })

  it('exposes the Bangla primary action labels from BRD §4.1', () => {
    expect(ACTION_LABELS.apply).toBe('আবেদন করুন')
    expect(ACTION_LABELS.pay).toBe('ভর্তি ফি দিন')
    expect(ACTION_LABELS.cancel).toBe('বাতিল')
  })
})
