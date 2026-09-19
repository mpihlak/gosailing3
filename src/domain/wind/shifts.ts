import { smoothstep, type Degrees, type Seconds } from '@/foundation/units'
import type { Rng } from '@/foundation/rng'
import type { WindModifier } from './types'

export interface ShiftKeyframe {
  readonly time: Seconds
  /** Offset from the median wind direction, positive clockwise. */
  readonly angle: Degrees
}

export interface ShiftOptions {
  /** How long a schedule to generate. Sampling past the end holds the last angle. */
  readonly duration: Seconds
  /** Largest offset from the median direction, in either direction. */
  readonly amplitude: Degrees
  readonly minPeriod: Seconds
  readonly maxPeriod: Seconds
  /**
   * A shift held from the start of the race, which is what makes one end of the start
   * line favored. It relaxes into the normal pattern once `biasUntil` passes.
   */
  readonly initialBias?: Degrees
  readonly biasUntil?: Seconds
  /** Smallest change between consecutive keyframes, so the breeze never goes flat. */
  readonly minChange?: Degrees
}

export function generateShiftSchedule(rng: Rng, options: ShiftOptions): ShiftKeyframe[] {
  const { duration, amplitude, minPeriod, maxPeriod, initialBias, biasUntil, minChange = 4 } = options

  const keyframes: ShiftKeyframe[] = []
  let time = 0
  let previous: Degrees

  if (initialBias !== undefined) {
    keyframes.push({ time: 0, angle: initialBias })
    time = biasUntil ?? minPeriod
    keyframes.push({ time, angle: initialBias })
    previous = initialBias
  } else {
    previous = rng.range(-amplitude, amplitude)
    keyframes.push({ time: 0, angle: previous })
  }

  while (time < duration) {
    time += rng.range(minPeriod, maxPeriod)
    let angle = rng.range(-amplitude, amplitude)
    // Reroll toward the far side rather than sitting still.
    if (Math.abs(angle - previous) < minChange) {
      angle = previous > 0 ? rng.range(-amplitude, -minChange) : rng.range(minChange, amplitude)
    }
    keyframes.push({ time, angle })
    previous = angle
  }
  return keyframes
}

/** The shift offset at a given time, eased between keyframes. */
export function shiftAt(schedule: readonly ShiftKeyframe[], time: Seconds): Degrees {
  if (schedule.length === 0) return 0
  const first = schedule[0] as ShiftKeyframe
  if (time <= first.time) return first.angle

  const last = schedule[schedule.length - 1] as ShiftKeyframe
  if (time >= last.time) return last.angle

  // Schedules are short and sampling is near-sequential, so a scan costs less than an index.
  for (let i = 1; i < schedule.length; i++) {
    const to = schedule[i] as ShiftKeyframe
    if (time <= to.time) {
      const from = schedule[i - 1] as ShiftKeyframe
      const span = to.time - from.time
      const t = span <= 0 ? 1 : smoothstep((time - from.time) / span)
      return from.angle + (to.angle - from.angle) * t
    }
  }
  return last.angle
}

export function oscillation(schedule: readonly ShiftKeyframe[]): WindModifier {
  return (sample, _position, time) => ({
    ...sample,
    direction: sample.direction + shiftAt(schedule, time),
  })
}
