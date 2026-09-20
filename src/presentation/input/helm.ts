import { clamp } from '@/foundation/units'
import type { BoatInput } from '@/domain/boat'
import type { InputSource } from '@/sim'

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
  private readonly held = new Set<string>()
  private pointerRudder = 0
  private detachers: (() => void)[] = []
  /** True once a touch has been seen, which is how the on-screen hints decide to appear. */
  touchDetected = false

  constructor(private readonly options: HelmOptions = {}) {}

  get rudder(): number {
    const keyboard =
      (this.held.has('left') ? -1 : 0) + (this.held.has('right') ? 1 : 0)
    return clamp(keyboard + this.pointerRudder, -1, 1)
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
      const side = sideFor(event.key)
      if (side) {
        event.preventDefault()
        this.held.add(side)
      }
    }
    const keyUp = (event: KeyboardEvent) => {
      const side = sideFor(event.key)
      if (side) this.held.delete(side)
    }

    const steerFromPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') this.touchDetected = true
      const bounds = target.getBoundingClientRect()
      const fraction = (event.clientX - bounds.left) / bounds.width
      this.pointerRudder = fraction < 0.4 ? -1 : fraction > 0.6 ? 1 : 0
    }
    const releasePointer = () => {
      this.pointerRudder = 0
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', () => this.held.clear())
    target.addEventListener('pointerdown', steerFromPointer)
    target.addEventListener('pointermove', (event) => {
      if (event.buttons > 0 || event.pointerType === 'touch') steerFromPointer(event)
    })
    target.addEventListener('pointerup', releasePointer)
    target.addEventListener('pointercancel', releasePointer)
    target.addEventListener('pointerleave', releasePointer)

    this.detachers = [
      () => window.removeEventListener('keydown', keyDown),
      () => window.removeEventListener('keyup', keyUp),
    ]
  }

  detach(): void {
    for (const detach of this.detachers) detach()
    this.detachers = []
    this.held.clear()
    this.pointerRudder = 0
  }
}

function sideFor(key: string): 'left' | 'right' | null {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left'
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right'
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
