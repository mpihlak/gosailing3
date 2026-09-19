import { createRng } from '@/foundation/rng'
import type { Vec2 } from '@/foundation/geom'
import type { Degrees, Knots, Meters, Seconds } from '@/foundation/units'
import { createWindField } from './field'
import { generateGusts, gusts, type GustCell } from './gusts'
import { sideGradient } from './gradient'
import { generateShiftSchedule, oscillation, type ShiftKeyframe } from './shifts'
import type { WindField, WindSample } from './types'

export interface RaceWindOptions {
  readonly seed: number | string
  readonly direction: Degrees
  readonly speed: Knots
  readonly courseCenter: Vec2
  readonly courseWidth: Meters
  readonly duration: Seconds
  /** Largest shift either side of the median direction. */
  readonly shiftAmplitude?: Degrees
  readonly shiftPeriod?: { min: Seconds; max: Seconds }
  /** How much stronger the favored side is, as a fraction of the median speed. */
  readonly gradientStrength?: number
  /** 0 disables gusts; 1 is a lively day. */
  readonly gustiness?: number
  /** Shift held over the start, which decides the favored end. Random when omitted. */
  readonly startBias?: Degrees
  readonly biasUntil?: Seconds
}

/** A wind field plus the choices it made, so the lab and the instruments can show them. */
export interface RaceWind extends WindField {
  readonly median: WindSample
  readonly schedule: readonly ShiftKeyframe[]
  readonly cells: readonly GustCell[]
  readonly favoredSide: 'left' | 'right'
  readonly startBias: Degrees
}

export function createRaceWind(options: RaceWindOptions): RaceWind {
  const {
    seed,
    direction,
    speed,
    courseCenter,
    courseWidth,
    duration,
    shiftAmplitude = 10,
    shiftPeriod = { min: 45, max: 110 },
    gradientStrength = 0.25,
    gustiness = 0.6,
    biasUntil = 90,
  } = options

  const rng = createRng(seed)
  const favoredSide = rng.split('side').bool() ? 'left' : 'right'
  const startBias =
    options.startBias ?? rng.split('bias').range(5, 15) * (rng.split('bias-side').bool() ? 1 : -1)

  const schedule = generateShiftSchedule(rng.split('shifts'), {
    duration,
    amplitude: shiftAmplitude,
    minPeriod: shiftPeriod.min,
    maxPeriod: shiftPeriod.max,
    initialBias: startBias,
    biasUntil,
  })

  const advantage = speed * gradientStrength
  const leftSpeed = favoredSide === 'left' ? speed + advantage : speed - advantage
  const rightSpeed = favoredSide === 'left' ? speed - advantage : speed + advantage

  const cells =
    gustiness <= 0
      ? []
      : generateGusts(rng.split('gusts'), {
          axis: direction,
          center: courseCenter,
          spread: courseWidth,
          duration,
          count: Math.round(12 * gustiness),
          radius: { min: courseWidth * 0.15, max: courseWidth * 0.4 },
          strength: { min: -speed * 0.2 * gustiness, max: speed * 0.3 * gustiness },
          bend: { min: -5 * gustiness, max: 5 * gustiness },
          driftSpeed: 4,
        })

  const median: WindSample = { direction, speed }
  const field = createWindField(median, [
    oscillation(schedule),
    sideGradient({
      axis: direction,
      leftSpeed,
      rightSpeed,
      center: courseCenter,
      halfWidth: courseWidth / 2,
    }),
    gusts(cells),
  ])

  return { sample: field.sample, median, schedule, cells, favoredSide, startBias }
}
