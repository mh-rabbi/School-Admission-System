import { describe, expect, it } from 'vitest'
import { validateClassForm } from '../lib/classForm'

describe('validateClassForm', () => {
  it('accepts a valid form and returns trimmed name and numeric seats', () => {
    expect(validateClassForm('  Class 6 - Morning Shift  ', ' 120 ')).toEqual({
      ok: true,
      value: { name: 'Class 6 - Morning Shift', totalSeats: 120 },
    })
  })

  it('accepts the exact limits', () => {
    expect(validateClassForm('x'.repeat(100), '1')).toMatchObject({ ok: true })
    expect(validateClassForm('x', '10000')).toMatchObject({ ok: true, value: { totalSeats: 10000 } })
  })

  it('converts Bengali digits and ignores leading zeros', () => {
    expect(validateClassForm('A', '১২০')).toMatchObject({ ok: true, value: { totalSeats: 120 } })
    expect(validateClassForm('A', '০০৫')).toMatchObject({ ok: true, value: { totalSeats: 5 } })
  })

  it.each([['', 'empty'], ['   ', 'blank'], ['\t\n', 'whitespace only']])('rejects a %j name (%s)', (name) => {
    const r = validateClassForm(name, '10')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.name).toMatch(/enter a class name/i)
  })

  it('rejects a name over 100 characters, counted after trimming', () => {
    const r = validateClassForm('x'.repeat(101), '10')
    expect(r.ok === false && r.errors.name).toMatch(/at most 100/i)
    expect(validateClassForm(` ${'x'.repeat(100)} `, '10').ok).toBe(true)
  })

  it.each([
    ['', /enter the total number/i],
    ['  ', /enter the total number/i],
    ['abc', /whole number/i],
    ['1.5', /whole number/i],
    ['1e3', /whole number/i],
    ['-5', /whole number/i],
    ['+5', /whole number/i],
    ['1,000', /whole number/i],
    ['0', /between 1 and 10,000/i],
    ['10001', /between 1 and 10,000/i],
    ['99999999999999999999', /between 1 and 10,000/i],
  ])('rejects seats %j', (seats, message) => {
    const r = validateClassForm('Class', seats)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.seats).toMatch(message)
  })

  it('reports both fields at once', () => {
    const r = validateClassForm('', 'x')
    expect(r.ok === false && Object.keys(r.errors).sort()).toEqual(['name', 'seats'])
  })
})
