import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Accessibility guard for the design tokens: every text/background pair the UI uses must reach WCAG 2.1 AA
 * (4.5:1 for normal text) in BOTH themes, including on the worst glass-over-gradient surface a card can sit on.
 * It reads the real tokens.css so a future colour change that breaks contrast fails the build.
 */
const css = readFileSync('src/styles/tokens.css', 'utf8') // vitest runs from the frontend folder

function block(selector: string): string {
  const start = css.indexOf(selector + ' {')
  if (start < 0) throw new Error(`no block ${selector}`)
  return css.slice(start, css.indexOf('\n}', start))
}
function vars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim()
  return out
}

const light = vars(block(':root'))
const darkManual = vars(block(":root[data-theme='dark']"))
const darkOs = vars(block(":root:not([data-theme='light'])")) // same palette, applied when the OS prefers dark
const dark = { ...light, ...darkManual }

it('the OS-dark and the manual-dark palettes are identical (they are written out twice in the CSS)', () => {
  expect(darkOs).toEqual(darkManual)
})

type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const v = h.replace('#', '')
  const f = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB
}
const rgba = (s: string): [RGB, number] => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(s)!
  return [[+m[1]!, +m[2]!, +m[3]!], +m[4]!]
}
const blend = (top: RGB, alpha: number, bottom: RGB): RGB => top.map((c, i) => c * alpha + bottom[i]! * (1 - alpha)) as RGB
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as RGB
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Surfaces text can sit on: the page, and a card (glass) over each gradient orb (orbs are drawn at 85 % opacity). */
function surfaces(t: Record<string, string>): { name: string; color: RGB }[] {
  const bg = hex(t.bg!)
  const [glass, alpha] = rgba(t.glass!)
  const list = [{ name: 'page', color: bg }]
  for (const o of ['o1', 'o2', 'o3']) {
    const orbOnPage = blend(hex(t[o]!), Number(t['orb-opacity']), bg) // body::after draws the orbs at --orb-opacity
    list.push({ name: `card over ${o}`, color: blend(glass, alpha, orbOnPage) })
  }
  return list
}

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast (WCAG AA, 4.5:1)', (_theme, t) => {
  const textOnSurface: [string, string][] = [
    ['ink', 'body text'],
    ['muted', 'secondary text'],
    ['secText', 'teal text (numbers, ok)'],
    ['accText', 'amber text (countdown)'],
    ['bad', 'error text'],
  ]

  it.each(textOnSurface)('%s (%s) is readable on the page and on every card surface', (token) => {
    for (const s of surfaces(t)) {
      expect(ratio(hex(t[token]!), s.color), `${token} on ${s.name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['secInk', 'sec', 'primary button'],
    ['accInk', 'acc', 'amber button and HELD chip'],
  ])('%s on %s (%s)', (fg, bgToken) => {
    expect(ratio(hex(t[fg]!), hex(t[bgToken]!))).toBeGreaterThanOrEqual(4.5)
  })
})
