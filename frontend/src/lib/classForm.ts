import type { CreateClassInput } from '../api/types'
import { toAsciiDigits } from './studentId'

/** Limits from the backend (BRD §4.1 / decision D10): name 1–100 characters (trimmed), seats 1–10,000. */
export const CLASS_NAME_MAX = 100
export const SEATS_MIN = 1
export const SEATS_MAX = 10_000

export interface FieldErrors {
  name?: string
  seats?: string
}

export type ClassFormResult = { ok: true; value: CreateClassInput } | { ok: false; errors: FieldErrors }

/**
 * Checks the create-class form before anything is sent, so obvious mistakes get an instant, specific message.
 * Seats are typed as text on purpose: <input type="number"> accepts "1e3", "1.5" and hides what was typed. Bengali
 * digits are converted, as for the registration number. The server still validates and its answer is also handled.
 */
export function validateClassForm(rawName: string, rawSeats: string): ClassFormResult {
  const errors: FieldErrors = {}

  const name = rawName.trim()
  if (name === '') errors.name = 'Enter a class name, for example "Class 6 - Morning Shift".'
  else if (name.length > CLASS_NAME_MAX) errors.name = `The class name can be at most ${CLASS_NAME_MAX} characters.`

  const seatsText = toAsciiDigits(rawSeats).trim()
  let seats = NaN
  if (seatsText === '') errors.seats = 'Enter the total number of seats.'
  else if (!/^[0-9]+$/.test(seatsText)) errors.seats = 'Total seats must be a whole number, using digits only.'
  else {
    seats = Number(seatsText)
    if (seats < SEATS_MIN || seats > SEATS_MAX)
      errors.seats = `Total seats must be between ${SEATS_MIN} and ${SEATS_MAX.toLocaleString('en-US')}.`
  }

  return errors.name || errors.seats ? { ok: false, errors } : { ok: true, value: { name, totalSeats: seats } }
}
