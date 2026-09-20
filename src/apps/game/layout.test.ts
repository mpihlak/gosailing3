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
const tillerHeight = css('tiller-height')
const standingsHeight = css('standings-height')

const wide = {
  gauge: css('gauge-width'),
  timer: css('timer-width'),
  gap: css('gauge-gap'),
  padding: css('edge-pad'),
  standings: css('standings-width'),
  until: css('one-row-until'),
}

const narrow = {
  gauge: css('gauge-narrow'),
  timer: css('gauge-narrow-timer'),
  gap: css('gauge-gap-narrow'),
  padding: css('edge-pad-narrow'),
  gaugeHeight: css('gauge-height-narrow'),
  standings: css('standings-narrow'),
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

describe('the board at the foot of the screen', () => {
  it('lines its left edge up with the telltales', () => {
    // The clock is centered, so the telltales start half a clock, the two gauges between
    // them and their own width in from the middle. The board is offset by the same sum.
    expect(PAGE).toMatch(
      /--telltales-offset:\s*calc\(\s*var\(--timer-width\) \/ 2 \+ var\(--gauge-width\) \* 2 \+ var\(--gauge-gap\) \* 3 \+\s*var\(--panel-width\)\s*\)/,
    )
    expect(PAGE).toMatch(
      /#standings\s*\{[^}]*margin-left: calc\(50% - var\(--telltales-offset\)\)/,
    )
  })

  it('stays on the screen at the narrowest width that still uses one row', () => {
    const offset = wide.timer / 2 + wide.gauge * 2 + wide.gap * 3 + panelWidth
    const left = wide.until / 2 - offset
    expect(left).toBeGreaterThanOrEqual(wide.padding)
    expect(left + wide.standings).toBeLessThanOrEqual(wide.until - wide.padding)
  })

  it('goes under the tiller where there is one, and takes the left edge back', () => {
    expect(PAGE).toMatch(/#tiller \{ display: block; order: 1; \}\s*#standings \{ order: 2; \}/)
    const stacked = PAGE.match(new RegExp(`@media \\(max-width: ${wide.until}px\\)([\\s\\S]*?)\\n      \\}`))
    expect(stacked?.[1] ?? '').toMatch(/#standings \{ margin-left: 0; \}/)
  })

  it('fits across a phone', () => {
    expect(narrow.standings).toBeLessThanOrEqual(SCREEN.width - narrow.padding * 2)
  })

  it('has room for a name and what she is sailing for', () => {
    // Place, name, the doing column and a penalty flag, at 13px and 11px.
    expect(narrow.standings).toBeGreaterThanOrEqual(150)
  })


})

describe('what is left for the water', () => {
  const aboveTheWater = NOTCH + narrow.padding + narrow.gaugeHeight + 6 + panelHeight
  const belowTheWater = tillerHeight + 8 + standingsHeight + HOME_INDICATOR

  it('leaves most of the screen to sail in', () => {
    const water = SCREEN.height - belowTheWater - aboveTheWater
    expect(water).toBeGreaterThan(SCREEN.height * 0.45)
  })

  it('keeps the instruments out of the top third', () => {
    expect(aboveTheWater).toBeLessThan(SCREEN.height / 3)
  })

  it('gives the tiller a thumb-sized bar', () => {
    // Anything under about forty-four points is hard to hit without looking.
    expect(tillerHeight).toBeGreaterThanOrEqual(44)
  })
})
