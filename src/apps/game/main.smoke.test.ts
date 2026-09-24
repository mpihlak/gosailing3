// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { bannerText, mountPage, tapOverlay, type MountedPage } from './page.harness'

/**
 * Starts the game against the real page and checks that it comes up: that it runs, draws,
 * and puts its first card up. Why this level is tested at all is in the harness.
 */

/** Every canvas call the game makes, so the test can see that it drew something. */
const drawn: string[] = []

let page: MountedPage
let clock = 0
/** Run a frame, so anything the game only notices while drawing gets noticed. */
const nextFrame = () => page.frame((clock += 16))

const press = (key: string) =>
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const release = (key: string) =>
  window.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }))

beforeAll(async () => {
  page = mountPage({ width: 1200, height: 800, record: drawn })
  await import('./main')
  // A handful of frames, enough to fill the instruments in.
  for (let n = 0; n < 4; n += 1) nextFrame()
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

  it('shows how fast each of them is going', () => {
    const speeds = [...document.querySelectorAll('#standings .speed')].map((it) => it.textContent)
    expect(speeds).toHaveLength(2)
    for (const speed of speeds) expect(speed).toMatch(/^\d+\.\d$/)
  })

  it('starts the race when the card is tapped', () => {
    tapOverlay()
    expect(document.querySelector<HTMLElement>('#overlay')?.dataset.visible).toBe('false')
  })
})

describe('watching the race run on', () => {
  /*
   * The boost multiplies whatever the rate keys are set to rather than setting a rate of
   * its own. Assigning instead would drop the player back to normal on release, losing a
   * rate she had chosen and never asked to change.
   */
  it('doubles what the rate keys are set to, and gives it back on release', () => {
    press('+')
    nextFrame()
    expect(bannerText()).toContain('2×')

    press('Shift')
    nextFrame()
    expect(bannerText()).toBe('Watching at 4×')

    release('Shift')
    nextFrame()
    expect(bannerText()).toBe('Watching at 2×')
  })

  it('says nothing while the key is simply not held', () => {
    const before = bannerText()
    nextFrame()
    nextFrame()
    expect(bannerText()).toBe(before)
  })

  it('is on the card of keys, where the player looks for it', () => {
    press('h')
    nextFrame()
    expect(document.querySelector('#overlay')?.textContent).toContain('Shift')
  })
})
