import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PANEL_HEIGHT, PANEL_WIDTH } from '@/presentation/render/layers/telltales'

/**
 * Does it all fit on a phone.
 *
 * This is arithmetic against the stylesheet's own numbers, not a rendered page: the tests
 * run without a browser and nothing here lays anything out. It cannot tell you that a box
 * looks right. What it can tell you is that the pieces add up to less than the screen, and
 * that is the thing that quietly stops being true when a gauge is widened or a panel
 * grows. Seeing it properly wants a real browser, and that is still not covered.
 */

const PAGE = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')

/** One of the sizes the narrow layout is budgeted with, read from the stylesheet. */
function css(property: string): number {
  const found = PAGE.match(new RegExp(`--${property}:\\s*(\\d+(?:\\.\\d+)?)px`))
  if (!found) throw new Error(`the stylesheet no longer defines --${property}`)
  return Number(found[1])
}

/** An iPhone 13 held upright, which is the phone this has to work on. */
const SCREEN = { width: 390, height: 844 }
/** Safe areas: the notch above, the home indicator below. */
const NOTCH = 47
const HOME_INDICATOR = 34

const gauge = css('gauge-narrow')
const wideGauge = css('gauge-narrow-wide')
const gap = css('gauge-gap-narrow')
const padding = css('hud-pad-narrow')
const gaugeHeight = css('gauge-height-narrow')
const standingsWidth = css('standings-width')
const tillerHeight = css('tiller-height')

const row = (normal: number, wide = 0): number =>
  normal * gauge + wide * wideGauge + (normal + wide - 1) * gap

describe('the instruments on a phone', () => {
  it('fits what she is doing on one row', () => {
    // Speed, TWA, TWS, VMG, Target VMG. The wind direction gauge is hidden here.
    expect(row(5)).toBeLessThanOrEqual(SCREEN.width - padding * 2)
  })

  it('fits where the race stands on the row below', () => {
    // Timer, To line, and the wider Next.
    expect(row(2, 1)).toBeLessThanOrEqual(SCREEN.width - padding * 2)
  })

  it('hides the wind direction, which is what makes the first row fit', () => {
    expect(PAGE).toMatch(/\[data-field='wind'\]\s*\{\s*display:\s*none/)
    expect(row(6)).toBeGreaterThan(SCREEN.width - padding * 2)
  })

  it('starts both rows at the same edge', () => {
    expect(PAGE).toMatch(/#hud\s*\{[^}]*justify-content:\s*flex-start/)
  })
})

describe('the panels in the corners', () => {
  const telltalesLeft = padding
  const telltalesRight = telltalesLeft + PANEL_WIDTH
  // The board is lined up with the outermost gauge, which on a phone ends the top row.
  const standingsRight = padding + row(5)
  const standingsLeft = standingsRight - standingsWidth

  it('does not have the telltales and the board on top of each other', () => {
    expect(standingsLeft).toBeGreaterThan(telltalesRight)
  })

  it('leaves a clear gap between them rather than touching', () => {
    expect(standingsLeft - telltalesRight).toBeGreaterThanOrEqual(16)
  })

  it('keeps them both on the screen', () => {
    expect(telltalesLeft).toBeGreaterThanOrEqual(0)
    expect(standingsRight).toBeLessThanOrEqual(SCREEN.width)
  })
})

describe('what is left for the water', () => {
  const belowTheWater = tillerHeight + 6 + gaugeHeight * 2 + gap + padding + HOME_INDICATOR
  const aboveTheWater = NOTCH + PANEL_HEIGHT

  it('leaves most of the screen to sail in', () => {
    const water = SCREEN.height - belowTheWater - aboveTheWater
    expect(water).toBeGreaterThan(SCREEN.height * 0.45)
  })

  it('keeps the tiller clear of the home indicator', () => {
    expect(belowTheWater).toBeLessThan(SCREEN.height / 3)
  })

  it('gives the tiller a thumb-sized bar', () => {
    // Anything under about forty-four points is hard to hit without looking.
    expect(tillerHeight).toBeGreaterThanOrEqual(44)
  })
})
