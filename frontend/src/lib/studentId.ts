/** Student registration number rules (BRD §4.1, backend StudentIds.cs): exactly 17 ASCII digits. */

export const STUDENT_ID_LENGTH = 17
/** The field accepts a little more than 17 characters so the user sees "too many digits" instead of silent truncation. */
export const STUDENT_ID_MAX_INPUT = 20

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Converts Bengali digits (০-৯) to ASCII. Everything else is left untouched. */
export function toAsciiDigits(raw: string): string {
  return raw.replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)))
}

/** Converts Bengali digits to ASCII and trims surrounding whitespace. */
export function normalizeStudentId(raw: string): string {
  return toAsciiDigits(raw).trim()
}

export function isValidStudentId(id: string): boolean {
  return /^[0-9]{17}$/.test(id)
}

export type StudentIdState = 'empty' | 'incomplete' | 'too-long' | 'bad-characters' | 'valid'

export interface StudentIdStatus {
  state: StudentIdState
  /** Short, specific guidance for the hint line under the field. */
  hint: string
  /** True for states that are definitely wrong (not merely unfinished) — drives aria-invalid. */
  invalid: boolean
}

/** Describes a normalised ID precisely, so the user knows what to fix. */
export function describeStudentId(normalized: string): StudentIdStatus {
  if (normalized === '')
    return { state: 'empty', hint: `Enter your ${STUDENT_ID_LENGTH}-digit registration number`, invalid: false }
  if (/[^0-9]/.test(normalized))
    return { state: 'bad-characters', hint: 'Only the digits 0–9 are allowed (no letters, spaces or symbols)', invalid: true }
  if (normalized.length > STUDENT_ID_LENGTH)
    return {
      state: 'too-long',
      hint: `Too many digits: ${normalized.length} entered, ${STUDENT_ID_LENGTH} needed`,
      invalid: true,
    }
  if (normalized.length < STUDENT_ID_LENGTH)
    return {
      state: 'incomplete',
      hint: `${normalized.length}/${STUDENT_ID_LENGTH} digits`,
      invalid: false,
    }
  return { state: 'valid', hint: 'ID looks good', invalid: false }
}
