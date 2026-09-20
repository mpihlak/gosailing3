// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Starts the game against the real page and checks that it comes up.
 *
 * Everything below the app is tested without a browser, which is what keeps it fast;
 * the wiring between them is not, and twice that has cost a blank screen — once a HUD
 * that wrote its banner over its own gauges, once a variable read while the module was
 * still being evaluated. Neither showed up in four hundred passing tests, because
 * nothing loaded the page.
 *
 * This is deliberately shallow. It does not check that anything looks right; it checks
 * that the thing runs, draws, and puts its first card up.
 */

/** Every canvas call the game makes, so the test can see that it drew something. */
const drawn: string[] = []

function recordingContext(): CanvasRenderingContext2D {
  const own: Record<string, unknown> = {}
  return new Proxy(own, {
    get(target, property: string) {
      if (property === 'canvas') return { width: 1200, height: 800 }
      if (property in target) return target[property]
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined })
      }
      return (...args: unknown[]) => {
        drawn.push(property)
        return args
      }
    },
    set(target, property: string, value) {
      target[property] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

function layOutThePage(): void {
  const page = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')
  const body = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
  // The page loads the game itself; here the test imports it, so the tag comes out.
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

beforeAll(async () => {
  layOutThePage()

  const element = window.HTMLElement.prototype
  Object.defineProperty(element, 'clientWidth', { get: () => 1200, configurable: true })
  Object.defineProperty(element, 'clientHeight', { get: () => 800, configurable: true })
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0 }) as DOMRect
  window.HTMLCanvasElement.prototype.getContext = (() => recordingContext()) as never

  // A handful of frames, then stop, so the loop does not run for ever.
  let frames = 0
  window.requestAnimationFrame = ((run: FrameRequestCallback) => {
    if (frames < 4) {
      frames += 1
      run(frames * 16)
    }
    return frames
  }) as typeof window.requestAnimationFrame

  await import('./main')
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
    const values = [...document.querySelectorAll('#hud .value')].map((cell) => cell.textContent)
    expect(values.length).toBeGreaterThan(5)
    expect(values.every((value) => value !== null && value !== '')).toBe(true)
    expect(values.filter((value) => value === '—').length).toBeLessThan(2)
  })

  it('puts both boats on the standings board', () => {
    const board = document.querySelector<HTMLElement>('#standings')
    expect(board?.textContent).toContain('Blue')
    expect(board?.textContent).toContain('Red')
  })

  it('starts the race when the card is tapped', () => {
    const overlay = document.querySelector<HTMLElement>('#overlay')
    overlay?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }))
    expect(overlay?.dataset.visible).toBe('false')
  })
})
