import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Puts the real page up in happy-dom and hands back the frame loop.
 *
 * Everything below the app is tested without a browser, which is what keeps it fast. The
 * wiring between them is not, and every time it has broken it has broken in a way four
 * hundred passing tests could not see: a HUD that wrote its banner over its own gauges, a
 * variable read while the module was still being evaluated, a card that invited a tap and
 * answered nothing. These tests are shallow on purpose. They check that the thing runs and
 * that what the player is shown is what the game meant to show.
 *
 * The caller imports the game itself, after mounting and never before: the module starts
 * the race and asks for its first frame as it is evaluated.
 */
export interface MountedPage {
  /**
   * Run the frame the game is waiting on, at that timestamp in milliseconds. False once
   * it has stopped asking for any.
   */
  readonly frame: (at: number) => boolean
}

export interface MountOptions {
  readonly width: number
  readonly height: number
  /** Every canvas call the game makes, if the test wants to see that it drew something. */
  readonly record?: string[]
}

export function mountPage({ width, height, record }: MountOptions): MountedPage {
  const page = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')
  const body = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>'))
  // The page loads the game itself; here the test imports it, so the tag comes out.
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')

  const element = window.HTMLElement.prototype
  Object.defineProperty(element, 'clientWidth', { get: () => width, configurable: true })
  Object.defineProperty(element, 'clientHeight', { get: () => height, configurable: true })
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 }) as DOMRect
  window.HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext(width, height, record)) as never

  // Frames are pumped by the test rather than by the browser, so a race only runs when it
  // is asked to and stops the moment the test has seen what it came for.
  let pending: FrameRequestCallback | undefined
  window.requestAnimationFrame = ((run: FrameRequestCallback) => {
    pending = run
    return 1
  }) as typeof window.requestAnimationFrame

  return {
    frame(at) {
      const run = pending
      pending = undefined
      if (!run) return false
      run(at)
      return true
    },
  }
}

/** A canvas that swallows everything and, if asked, keeps a list of what it was told. */
function canvasContext(
  width: number,
  height: number,
  record?: string[],
): CanvasRenderingContext2D {
  const own: Record<string, unknown> = {}
  return new Proxy(own, {
    get(target, property: string) {
      if (property === 'canvas') return { width, height }
      if (property in target) return target[property]
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined })
      }
      return () => {
        record?.push(property)
        return undefined
      }
    },
    set(target, property: string, value) {
      target[property] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

/** Tapping a card, which is all a phone has. */
export function tapOverlay(): void {
  document
    .querySelector('#overlay')
    ?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }))
}

export function overlayText(): string {
  return document.querySelector('#overlay')?.textContent ?? ''
}

export function bannerText(): string {
  return document.querySelector('[data-banner]')?.textContent ?? ''
}
