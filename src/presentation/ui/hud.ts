import { normalizeBearing, toRadians } from '@/foundation/geom'
import type { Degrees, Knots, Seconds } from '@/foundation/units'
import { formatRate } from '@/presentation/view/timescale'

export interface Instruments {
  readonly speed: Knots
  readonly heading: Degrees
  readonly twa: Degrees
  readonly windDirection: Degrees
  readonly windSpeed: Knots
  /** Speed made good toward the next mark's side of the course. */
  readonly vmg: Knots
  /** Boat speed as a fraction of what the polar says is available. */
  readonly polarRatio: number
  readonly timeToStart: Seconds
  readonly raceTime: Seconds
  readonly distanceToLine?: number
  readonly status: string
  readonly place?: number
  /** How fast the race is running against the clock. */
  readonly timeScale: number
}

const FIELDS = [
  'speed',
  'heading',
  'twa',
  'vmg',
  'polar',
  'wind',
  'timer',
  'line',
  'status',
  'rate',
] as const
type Field = (typeof FIELDS)[number]

export class Hud {
  private readonly cells = new Map<Field, HTMLElement>()
  private readonly banner: HTMLElement

  constructor(root: HTMLElement) {
    for (const field of FIELDS) {
      const cell = root.querySelector<HTMLElement>(`[data-field="${field}"] .value`)
      if (cell) this.cells.set(field, cell)
    }
    this.banner = root.querySelector<HTMLElement>('[data-banner]') ?? root
  }

  update(instruments: Instruments): void {
    const {
      speed,
      heading,
      twa,
      vmg,
      polarRatio,
      windDirection,
      windSpeed,
      timeToStart,
      raceTime,
      distanceToLine,
      status,
      timeScale,
    } = instruments

    this.set('speed', `${speed.toFixed(1)}`)
    this.set('heading', `${Math.round(normalizeBearing(heading))}°`)
    this.set('twa', `${Math.round(Math.abs(twa))}° ${twa >= 0 ? 'P' : 'S'}`)
    this.set('vmg', vmg.toFixed(1))
    this.set('polar', `${Math.round(polarRatio * 100)}%`)
    this.set('wind', `${Math.round(normalizeBearing(windDirection))}° ${windSpeed.toFixed(1)}kt`)
    this.set('timer', timeToStart > 0 ? `−${clock(timeToStart)}` : clock(Math.max(0, raceTime)))
    this.set('line', distanceToLine === undefined ? '—' : `${Math.round(distanceToLine)}m`)
    this.set('status', status)
    this.set('rate', formatRate(timeScale))
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
}

export function clock(seconds: Seconds): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

/** Speed made good straight upwind, which is what a beat is actually scored on. */
export function velocityMadeGood(speed: Knots, twa: Degrees): Knots {
  return speed * Math.cos(toRadians(twa))
}
