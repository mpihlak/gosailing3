import { clamp } from '@/foundation/units'
import type { BoatInput } from '@/domain/boat'
import type { InputSource } from '@/sim'
import type { Tiller } from './tiller'

export type HelmCommand =
  | 'toggleRun'
  | 'restart'
  | 'help'
  | 'faster'
  | 'slower'
  | 'normalRate'
  | 'toggleShadows'
  | 'toggleLaylines'

export interface HelmOptions {
  readonly onCommand?: (command: HelmCommand) => void
}

/**
 * Turns whatever the player is doing into the same `BoatInput` an AI produces. Keyboard
 * and touch both land here, so nothing downstream needs to know which one is in use.
 */
export class Helm implements InputSource {
  private readonly held = new Set<HeldKey>()
  private detachers: (() => void)[] = []
  /** The tiller, when there is one. A keyboard and a thumb both end up here. */
  tiller: Tiller | undefined
  /** True once a touch has been seen, which is how the on-screen hints decide to appear. */
  touchDetected = false

  constructor(private readonly options: HelmOptions = {}) {}

  get rudder(): number {
    const keyboard = (this.held.has('left') ? -1 : 0) + (this.held.has('right') ? 1 : 0)
    return clamp(keyboard + (this.tiller?.rudder ?? 0), -1, 1)
  }

  /**
   * Whether the player is asking to watch the race run on. Held rather than toggled, and
   * kept in the same set as the steering keys so that losing the window cancels it: a
   * release that arrives somewhere else would otherwise leave the race running away.
   */
  get boost(): boolean {
    return this.held.has('boost')
  }

  inputFor(): BoatInput {
    return { rudder: this.rudder }
  }

  attach(target: HTMLElement): void {
    const keyDown = (event: KeyboardEvent) => {
      const action = commandFor(event.key)
      if (action) {
        event.preventDefault()
        // Held keys repeat. Steering wants that; a command does not, or one press on the
        // rate key would run through every step of the ladder.
        if (!event.repeat) this.options.onCommand?.(action)
        return
      }
      const held = heldFor(event.key)
      if (held) {
        // Arrows scroll the page and want stopping. Shift on its own does nothing, and
        // taking it over would break the browser's own combinations.
        if (held !== 'boost') event.preventDefault()
        this.held.add(held)
      }
    }
    const keyUp = (event: KeyboardEvent) => {
      const held = heldFor(event.key)
      if (held) this.held.delete(held)
    }

    /*
     * A touch on the water is not steering — that is the tiller's job — so it is taken
     * as asking to stop or carry on. Only a tap: a drag is somebody's thumb moving, not
     * somebody asking for anything.
     */
    let touchedAt: { x: number; y: number; at: number } | undefined

    const noteTouch = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      this.touchDetected = true
      touchedAt = { x: event.clientX, y: event.clientY, at: event.timeStamp }
    }
    const finishTouch = (event: PointerEvent) => {
      if (!touchedAt || event.pointerType !== 'touch') return
      const moved = Math.hypot(event.clientX - touchedAt.x, event.clientY - touchedAt.y)
      const held = event.timeStamp - touchedAt.at
      touchedAt = undefined
      if (moved < 12 && held < 400) this.options.onCommand?.('toggleRun')
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', () => this.held.clear())
    target.addEventListener('pointerdown', noteTouch)
    target.addEventListener('pointerup', finishTouch)
    target.addEventListener('pointercancel', () => {
      touchedAt = undefined
    })

    this.detachers = [
      () => window.removeEventListener('keydown', keyDown),
      () => window.removeEventListener('keyup', keyUp),
    ]
  }

  detach(): void {
    for (const detach of this.detachers) detach()
    this.detachers = []
    this.held.clear()
  }
}

type HeldKey = 'left' | 'right' | 'boost'

function heldFor(key: string): HeldKey | null {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left'
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right'
  if (key === 'Shift') return 'boost'
  return null
}

function commandFor(key: string): HelmCommand | null {
  if (key === ' ' || key === 'Spacebar') return 'toggleRun'
  if (key === 'r' || key === 'R') return 'restart'
  if (key === 'h' || key === 'H' || key === '?') return 'help'
  if (key === 'w' || key === 'W') return 'toggleShadows'
  if (key === 'l' || key === 'L') return 'toggleLaylines'
  // Accept the key both shifted and not, so it works without reaching for shift.
  if (key === '+' || key === '=') return 'faster'
  if (key === '-' || key === '_') return 'slower'
  if (key === '0') return 'normalRate'
  return null
}
