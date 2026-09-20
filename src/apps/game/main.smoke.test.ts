// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { mountPage, tapOverlay } from './page.harness'

/**
 * Starts the game against the real page and checks that it comes up: that it runs, draws,
 * and puts its first card up. Why this level is tested at all is in the harness.
 */

/** Every canvas call the game makes, so the test can see that it drew something. */
const drawn: string[] = []

beforeAll(async () => {
  const page = mountPage({ width: 1200, height: 800, record: drawn })
  await import('./main')
  // A handful of frames, enough to fill the instruments in.
  for (let n = 1; n <= 4; n += 1) page.frame(n * 16)
})

describe('the game, started against the real page', () => {
  it('comes up without throwing', () => {
    // Nothing to assert beyond having got here: an exception during the module's own
    // evaluation would have failed the whole file.
    expect(document.querySelector('#stage')).not.toBeNull()
  })

  it('draws the water', () => {
    expect(drawn).toContain('fillRect')
    expect(drawn.length).toBeGreaterThan(50)
  })

  it('puts the ready card up, and says which boat is yours', () => {
    const overlay = document.querySelector<HTMLElement>('#overlay')
    expect(overlay?.dataset.visible).toBe('true')
    expect(overlay?.textContent).toContain('Blue')
    expect(overlay?.textContent).toContain('Red')
  })

  it('fills in the instruments rather than leaving them blank', () => {
    // Speed, TWA, the clock, TWS and %VMG.
    const values = [...document.querySelectorAll('#hud .value')].map((cell) => cell.textContent)
    expect(values.length).toBe(5)
    expect(values.every((value) => value !== null && value !== '')).toBe(true)
    expect(values.filter((value) => value === '—').length).toBeLessThan(2)
  })

  it('puts both boats on the board, with what each is sailing for', () => {
    const board = document.querySelector<HTMLElement>('#standings')
    expect(board?.textContent).toContain('Blue')
    expect(board?.textContent).toContain('Red')
    const doing = [...document.querySelectorAll('#standings .doing')].map((it) => it.textContent)
    expect(doing).toEqual(['to start', 'to start'])
  })

  it('starts the race when the card is tapped', () => {
    tapOverlay()
    expect(document.querySelector<HTMLElement>('#overlay')?.dataset.visible).toBe('false')
  })
})
