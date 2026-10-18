import { normalizeBearing, type Vec2 } from '@/foundation/geom'
import type { Seconds } from '@/foundation/units'
import type { RaceWind } from './presets'
import { shiftAt } from './shifts'
import type { WindField, WindSample } from './types'

/**
 * A race's wind whose shifts can be stopped and started again. The shifts keep a clock
 * of their own that stands still while they are frozen: frozen, the wind holds the
 * shift it had, and started again it carries on from there rather than jumping to
 * wherever the schedule had got to meanwhile. Gusts and the pressure across the course
 * carry on regardless.
 */
export class FreezableWind implements WindField {
  /** Race time when the shifts were frozen, while they are. */
  private frozenAt: Seconds | undefined
  /** Race time spent frozen so far, which the shifts' clock is behind by. */
  private behind: Seconds = 0

  constructor(
    private readonly wind: RaceWind,
    frozenFrom?: Seconds,
  ) {
    this.frozenAt = frozenFrom
  }

  get frozen(): boolean {
    return this.frozenAt !== undefined
  }

  freeze(time: Seconds): void {
    this.frozenAt ??= time
  }

  unfreeze(time: Seconds): void {
    if (this.frozenAt === undefined) return
    this.behind += Math.max(0, time - this.frozenAt)
    this.frozenAt = undefined
  }

  sample(position: Vec2, time: Seconds): WindSample {
    const live = this.wind.sample(position, time)
    const clock = (this.frozenAt ?? time) - this.behind
    const { schedule } = this.wind
    return {
      ...live,
      direction: normalizeBearing(
        live.direction - shiftAt(schedule, time) + shiftAt(schedule, clock),
      ),
    }
  }
}
