import { normalizeBearing, normalizeSigned, toRadians } from '@/foundation/geom'
import { clamp, type Degrees, type Knots, type Seconds } from '@/foundation/units'
import type { Polar } from '@/domain/polars'

export interface Instruments {
  readonly speed: Knots
  readonly twa: Degrees
  readonly windDirection: Degrees
  readonly windSpeed: Knots
  /** Speed made good toward the next mark's side of the course. */
  readonly vmg: Knots
  /** VMG as a fraction of the best available in this wind. */
  readonly vmgRatio: number
  /**
   * Sailing seconds, not the seconds the player sits through. The clock has to agree
   * with the boat speed and the distance to the line for a start to be timed against it,
   * and those are in knots and meters however fast the race is being played.
   */
  readonly timeToStart: Seconds
  readonly raceTime: Seconds
  readonly distanceToLine?: number
  readonly status: string
  readonly place?: number
}

const FIELDS = [
  'speed',
  'twa',
  'tws',
  'vmg',
  'targetVmg',
  'wind',
  'timer',
  'line',
  'status',
] as const
type Field = (typeof FIELDS)[number]

export class Hud {
  private readonly cells = new Map<Field, HTMLElement>()
  private readonly banner: HTMLElement

  /**
   * The banner is passed in rather than looked up, because it sits outside the instrument
   * panel. Falling back to the panel when the lookup missed cost the whole HUD: writing
   * the banner text into it replaced every gauge with a single line of text.
   */
  constructor(root: HTMLElement, banner: HTMLElement) {
    for (const field of FIELDS) {
      const cell = root.querySelector<HTMLElement>(`[data-field="${field}"] .value`)
      if (!cell) throw new Error(`the instrument panel is missing a cell for "${field}"`)
      this.cells.set(field, cell)
    }
    this.banner = banner
  }

  update(instruments: Instruments): void {
    const {
      speed,
      twa,
      vmg,
      vmgRatio,
      windDirection,
      windSpeed,
      timeToStart,
      raceTime,
      distanceToLine,
      status,
    } = instruments

    this.set('speed', `${speed.toFixed(1)}`)
    this.set('twa', `${Math.round(Math.abs(twa))}° ${twa >= 0 ? 'P' : 'S'}`)
    this.set('tws', windSpeed.toFixed(1))
    this.set('vmg', vmg.toFixed(1))
    this.set('targetVmg', `${Math.round(vmgRatio * 100)}%`)
    // Wind speed has its own gauge beside the angle, so this one carries the direction.
    this.set('wind', `${Math.round(normalizeBearing(windDirection))}°`)
    this.set(
      'timer',
      timeToStart > 0 ? `−${countdown(timeToStart)}` : clock(Math.max(0, raceTime)),
    )
    this.set('line', distanceToLine === undefined ? '—' : `${Math.round(distanceToLine)}m`)
    this.set('status', status)
  }

  showBanner(text: string, tone: 'info' | 'warn' | 'good' = 'info', holdMs = 2600): void {
    this.banner.textContent = text
    this.banner.dataset.tone = tone
    this.banner.dataset.visible = 'true'
    window.clearTimeout(Number(this.banner.dataset.timer ?? 0))
    const timer = window.setTimeout(() => {
      this.banner.dataset.visible = 'false'
    }, holdMs)
    this.banner.dataset.timer = String(timer)
  }

  private set(field: Field, text: string): void {
    const cell = this.cells.get(field)
    if (cell && cell.textContent !== text) cell.textContent = text
  }

  /** Which instruments the panel is wired to, so a smoke test can check the markup. */
  get fields(): readonly string[] {
    return [...this.cells.keys()]
  }
}

/** Time gone: rounded down, because at 1:52 she has completed 1:52. */
export function clock(seconds: Seconds): string {
  return minutesAndSeconds(Math.floor(Math.max(0, seconds)))
}

/**
 * Time still to run: rounded up, so 0:01 means up to a second is left and 0:00 means the
 * gun has gone. Rounded down it read 0:00 for the whole of the last second before the
 * start — a second of telling the player the race had begun when it had not, and at the
 * pace the game runs at, thirteen meters of boat.
 */
export function countdown(seconds: Seconds): string {
  return minutesAndSeconds(Math.ceil(Math.max(0, seconds)))
}

/**
 * Minutes, seconds and hundredths, for a results sheet where two boats can be a length
 * apart. The simulation steps sixty times a second, so the last digit is as fine as the
 * game can tell: two boats crossing in the same tick will read the same.
 */
export function timing(seconds: Seconds): string {
  const hundredths = Math.round(Math.max(0, seconds) * 100)
  const minutes = Math.floor(hundredths / 6000)
  const rest = hundredths - minutes * 6000
  const whole = Math.floor(rest / 100)
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(rest % 100).padStart(2, '0')}`
}

function minutesAndSeconds(whole: number): string {
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

/** Speed made good straight upwind, which is what a beat is actually scored on. */
export function velocityMadeGood(speed: Knots, twa: Degrees): Knots {
  return speed * Math.cos(toRadians(twa))
}

/**
 * How much of the VMG available in this wind the boat is actually making.
 *
 * Speed against the polar at the angle she happens to be sailing says only whether she
 * is going as fast as that angle allows, and a boat pinched badly can be at 100% of a
 * hopeless angle. Measuring against the best VMG on offer judges the angle and the speed
 * together, which is the question a beat is actually about.
 *
 * On a beam reach the honest answer is near zero: VMG is what you make toward the mark,
 * and across the wind you make almost none. The number is right; it is simply not the
 * number to sail by there.
 */
export function targetVmgRatio(polar: Polar, speed: Knots, twa: Degrees, tws: Knots): number {
  const best = Math.abs(normalizeSigned(twa)) < 90 ? polar.beatTarget(tws) : polar.runTarget(tws)
  if (best.vmg <= 0.05) return 0
  return clamp(Math.abs(velocityMadeGood(speed, twa)) / best.vmg, 0, 2)
}
