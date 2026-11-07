import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PANEL_HEIGHT, PANEL_WIDTH } from '@/presentation/render/layers/telltales'

/**
 * Does it all fit.
 *
 * This is arithmetic against the stylesheet's own numbers, not a rendered page: the tests
 * run without a browser and nothing here lays anything out. It cannot tell you that a box
 * looks right. What it can tell you is that the pieces add up to less than the screen, and
 * that is the thing that quietly stops being true when a gauge is widened or a panel
 * grows. Seeing it properly wants a real browser, and that is still not covered.
 */

const PAGE = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')

/** One of the sizes the layout is budgeted with, read from the stylesheet. */
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

const panelWidth = css('panel-width')
const panelHeight = css('panel-height')
/** The bottom third of the screen, which the stylesheet gives the tiller. */
const tillerHeight = SCREEN.height / 3
const tillerWidth = css('tiller-width')

const wide = {
  gauge: css('gauge-width'),
  timer: css('timer-width'),
  gap: css('gauge-gap'),
  padding: css('edge-pad'),
  until: css('one-row-until'),
}

const narrow = {
  gauge: css('gauge-narrow'),
  timer: css('gauge-narrow-timer'),
  gap: css('gauge-gap-narrow'),
  padding: css('edge-pad-narrow'),
  gaugeHeight: css('gauge-height-narrow'),
}

/** Speed, TWA, the clock, TWS and %VMG, all on one line. */
function instruments(size: { gauge: number; timer: number; gap: number }): number {
  return size.gauge * 4 + size.timer + size.gap * 4
}

describe('the telltales', () => {
  it('are the same box on the canvas as the page keeps for them', () => {
    // One is painted by the renderer, the other is a div in the instrument row. A change
    // to either that the other does not follow moves the panel off its slot.
    expect(panelWidth).toBe(PANEL_WIDTH)
    expect(panelHeight).toBe(PANEL_HEIGHT)
  })

  it('sit next to the speed, not out at the edge of the screen', () => {
    const order = [...PAGE.matchAll(/(id="telltales"|data-field="(speed|twa|tws|targetVmg)")/g)].map(
      (found) => found[2] ?? 'telltales',
    )
    expect(order).toEqual(['telltales', 'speed', 'twa', 'tws', 'targetVmg'])
  })
})

describe('the instruments on one row', () => {
  /*
   * Three grid columns, the clock in the middle one. Both side columns are 1fr, so each
   * is as wide as the one that needs more — the telltales, the speed and the angle.
   */
  const side = panelWidth + wide.gauge * 2 + wide.gap * 2
  const content = side * 2 + wide.timer + wide.gap * 2 + wide.padding * 2

  it('fits the whole row down to the width it gives up at', () => {
    expect(content).toBeLessThanOrEqual(wide.until)
  })

  it('keeps the clock on the center line, with the sides closing in on it', () => {
    expect(PAGE).toMatch(/#hud\s*\{[^}]*grid-template-columns:\s*1fr auto 1fr/)
    expect(PAGE).toMatch(/\.side\.left\s*\{[^}]*justify-content:\s*flex-end/)
    expect(PAGE).toMatch(/\.side\.right\s*\{[^}]*justify-content:\s*flex-start/)
  })

  it('draws the clock larger than the gauges beside it', () => {
    expect(wide.timer).toBeGreaterThan(wide.gauge)
    expect(narrow.timer).toBeGreaterThan(narrow.gauge)
  })
})

describe('the instruments once the row is too wide for the screen', () => {
  const stacked = new RegExp(`@media \\(max-width: ${wide.until}px\\)([\\s\\S]*?)\\n      \\}`)

  it('drops the telltales onto a line of their own', () => {
    const rules = PAGE.match(stacked)?.[1] ?? ''
    expect(rules).toMatch(/\.row-break\s*\{[^}]*flex-basis: 100%/)
    expect(rules).toMatch(/#telltales\s*\{\s*order: 7/)
  })

  it('puts the telltales against the left edge, where the board is', () => {
    const rules = PAGE.match(stacked)?.[1] ?? ''
    expect(rules).toMatch(/#telltales\s*\{[^}]*margin-right: auto/)
    // Both edges are inset by the same custom property, so the two line up.
    expect(PAGE).toMatch(/#top\s*\{[^}]*max\(var\(--edge-pad\), env\(safe-area-inset-left\)\)/)
    expect(PAGE).toMatch(/#bottom\s*\{[^}]*max\(var\(--edge-pad\), env\(safe-area-inset-left\)\)/)
  })

  it('still fits the five instruments across the narrowest screen', () => {
    expect(instruments(narrow)).toBeLessThanOrEqual(SCREEN.width - narrow.padding * 2)
  })

  it('fits them at the wider sizes too, right down to where the narrow ones take over', () => {
    // The sizes only shrink at 560px, so everything above that uses the wide budget.
    expect(instruments(wide)).toBeLessThanOrEqual(561 - wide.padding * 2)
  })

  it('leaves the telltales room on the line below', () => {
    expect(panelWidth).toBeLessThanOrEqual(SCREEN.width - narrow.padding * 2)
  })
})

/** Where the instruments end and the tiller begins on a phone. */
const aboveTheWater = NOTCH + narrow.padding + narrow.gaugeHeight + 6 + panelHeight
const belowTheWater = tillerHeight + narrow.padding + HOME_INDICATOR

describe('the board under the telltales', () => {
  it("hangs from the instruments, its left edge on the telltales'", () => {
    expect(PAGE).toMatch(/#hud\s*\{[^}]*position: relative;/)
    expect(PAGE).toMatch(/<div id="hud">[\s\S]*<div id="standings"><\/div>\s*<\/div>/)
    expect(PAGE).toMatch(
      /#standings\s*\{[^}]*left: calc\(\s*50% - var\(--timer-width\) \/ 2 - var\(--gauge-width\) \* 2 - var\(--gauge-gap\) \* 3 -\s*var\(--panel-width\)\s*\)/,
    )
  })

  it('stays on the screen at the narrowest width that still uses one row', () => {
    const left = wide.until / 2 - wide.timer / 2 - wide.gauge * 2 - wide.gap * 3 - panelWidth
    expect(left).toBeGreaterThanOrEqual(wide.padding)
  })

  it('takes the left edge with the telltales once they go under the instruments', () => {
    const stacked = PAGE.match(
      new RegExp(`@media \\(max-width: ${wide.until}px\\)([\\s\\S]*?)\\n      \\}`),
    )
    expect(stacked?.[1] ?? '').toMatch(/#standings \{ left: 0; \}/)
  })

  it('stands on the bottom edge where there is a tiller, over it', () => {
    const touch = PAGE.match(/@media \(pointer: coarse\), \(max-width: 560px\) \{([\s\S]*?)\n {6}\}/)
    expect(touch?.[1] ?? '').toMatch(
      /#standings \{[^}]*position: fixed;[^}]*bottom: max\(var\(--edge-pad-narrow\), env\(safe-area-inset-bottom\)\);/,
    )
  })

  it('fits a fleet of ten between the instruments and the bottom of a phone', () => {
    // A row is its 18px line and the 1px gap under it.
    const board = HOME_INDICATOR + 10 * 19
    expect(SCREEN.height - board).toBeGreaterThan(aboveTheWater)
  })

  it('lets a thumb on the board steer, because the board takes no touches', () => {
    expect(PAGE).toMatch(/#top \{[^}]*pointer-events: none;/)
    expect(PAGE).toMatch(/<div id="top">[\s\S]*<div id="standings">/)
  })
})

describe('what is left for the water', () => {
  it('leaves the water clear between the instruments and the tiller', () => {
    const water = SCREEN.height - belowTheWater - aboveTheWater
    expect(water).toBeGreaterThan(SCREEN.height * 0.3)
  })

  it('lets the water show through the tiller, which draws only its arc', () => {
    const tiller = PAGE.match(/#tiller \{([^}]*)\}/)?.[1] ?? ''
    expect(tiller).not.toMatch(/background/)
  })

  it('keeps the instruments out of the top third', () => {
    expect(aboveTheWater).toBeLessThan(SCREEN.height / 3)
  })

  it('gives the tiller the bottom third of the screen', () => {
    expect(PAGE).toMatch(/--tiller-height: calc\(100dvh \/ 3\);/)
  })

  it('fits the tiller across a phone', () => {
    expect(tillerWidth).toBeLessThanOrEqual(SCREEN.width - narrow.padding * 2)
  })

  it('caps how wide the arc gets, because a wider arc is a slower helm', () => {
    // The rudder comes from how far the thumb moves against the arc's width, so across a
    // tablet the same movement was worth a third of the rudder it is worth on a phone.
    expect(PAGE).toMatch(/#tiller svg \{[^}]*max-width: var\(--tiller-width\)/)
    expect(tillerWidth).toBeLessThanOrEqual(SCREEN.width)
  })
})
