import { describe, expect, it } from 'vitest'
import { describeStudentId, isValidStudentId, normalizeStudentId } from '../lib/studentId'

const ID = '20152691234567890'
const BENGALI_ID = '২০১৫২৬৯১২৩৪৫৬৭৮৯০'

describe('normalizeStudentId', () => {
  it('converts every Bengali digit to ASCII', () => {
    expect(normalizeStudentId('০১২৩৪৫৬৭৮৯')).toBe('0123456789')
    expect(normalizeStudentId(BENGALI_ID)).toBe(ID)
  })

  it('handles mixed Bengali and ASCII digits', () => {
    expect(normalizeStudentId('২০15২৬91২৩৪৫৬৭৮৯০')).toBe(ID)
  })

  it('trims surrounding whitespace but keeps inner characters so mistakes stay visible', () => {
    expect(normalizeStudentId(`  ${ID}\n`)).toBe(ID)
    expect(normalizeStudentId('2015 2691')).toBe('2015 2691')
    expect(normalizeStudentId('abc')).toBe('abc')
  })
})

describe('isValidStudentId', () => {
  it('accepts exactly 17 ASCII digits', () => {
    expect(isValidStudentId(ID)).toBe(true)
    expect(isValidStudentId(normalizeStudentId(BENGALI_ID))).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['16 digits', ID.slice(0, 16)],
    ['18 digits', ID + '1'],
    ['letters', '2015269123456789a'],
    ['inner space', '2015269 234567890'],
    ['untrimmed', ` ${ID}`],
    ['raw Bengali digits (backend rejects them)', BENGALI_ID],
    ['trailing newline', `${ID}\n`],
  ])('rejects %s', (_name, value) => {
    expect(isValidStudentId(value)).toBe(false)
  })
})

describe('describeStudentId', () => {
  it('empty: neutral prompt', () => {
    expect(describeStudentId('')).toMatchObject({ state: 'empty', invalid: false })
  })

  it('incomplete: shows progress, not an error', () => {
    expect(describeStudentId('2015')).toEqual({ state: 'incomplete', hint: '4/17 digits', invalid: false })
  })

  it('valid', () => {
    expect(describeStudentId(ID)).toMatchObject({ state: 'valid', hint: 'ID looks good', invalid: false })
  })

  it('too long: says how many were entered', () => {
    expect(describeStudentId(ID + '12')).toMatchObject({ state: 'too-long', invalid: true })
    expect(describeStudentId(ID + '12').hint).toContain('19 entered')
  })

  it('bad characters win over length', () => {
    expect(describeStudentId('2015abc')).toMatchObject({ state: 'bad-characters', invalid: true })
    expect(describeStudentId('2015 2691')).toMatchObject({ state: 'bad-characters', invalid: true })
  })
})
