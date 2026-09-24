import { clamp, lerp, type Degrees, type Knots } from '@/foundation/units'
import { normalizeSigned, toRadians } from '@/foundation/geom'
import { validateTable, type BeatPoint, type PolarTable } from './table'

/**
 * Queries against a polar table. A polar is immutable and pure: the same angle and
 * wind speed always give the same boat speed, which is what lets the physics, the AI
 * tactician and the instruments all agree about what the boat should be doing.
 */
export interface Polar {
  readonly name: string
  readonly table: PolarTable
  /** Speed through the water at a true wind angle, in knots. Sign of the angle is ignored. */
  boatSpeed(twa: Degrees, tws: Knots): Knots
  /** Speed made good toward the wind. Positive upwind, negative downwind. */
  vmg(twa: Degrees, tws: Knots): Knots
  /** The true wind angle that maximizes upwind VMG. */
  beatAngle(tws: Knots): Degrees
  /** The true wind angle that maximizes downwind VMG. */
  runAngle(tws: Knots): Degrees
  /** Best achievable VMG upwind, and the boat speed that goes with it. */
  beatTarget(tws: Knots): { angle: Degrees; vmg: Knots; speed: Knots }
  runTarget(tws: Knots): { angle: Degrees; vmg: Knots; speed: Knots }
  /** Fastest the boat will go at this wind speed, at any angle. */
  maxSpeed(tws: Knots): Knots
}

interface Bracket {
  readonly lower: number
  readonly upper: number
  readonly t: number
}

/** Locate a value between two samples, clamping rather than extrapolating past the ends. */
function bracket(values: readonly number[], value: number): Bracket {
  const last = values.length - 1
  if (value <= (values[0] as number)) return { lower: 0, upper: 0, t: 0 }
  if (value >= (values[last] as number)) return { lower: last, upper: last, t: 0 }
  for (let i = 0; i < last; i++) {
    const low = values[i] as number
    const high = values[i + 1] as number
    if (value <= high) return { lower: i, upper: i + 1, t: (value - low) / (high - low) }
  }
  return { lower: last, upper: last, t: 0 }
}

function sample(values: readonly number[], at: Bracket): number {
  return lerp(values[at.lower] as number, values[at.upper] as number, at.t)
}

/**
 * Where a boat stops sailing, as a fraction of her best beat angle. Head to wind is not
 * the place: sails stall well before that, and a boat pointed ten degrees off it is going
 * nowhere however long you wait.
 */
const STALL_FRACTION = 0.55

export function createPolar(table: PolarTable): Polar {
  validateTable(table)

  const { windSpeeds, angles, speeds, beat } = table
  const firstAngle = angles[0] as number
  const beatAngles = beat.map((point) => point.angle)
  const beatVmgs = beat.map((point) => point.vmg)

  /** Boat speed straight from the measured table, bilinear across wind speed and angle. */
  const tableSpeed = (twa: Degrees, windAt: Bracket): Knots => {
    const angleAt = bracket(angles, twa)
    const lowRow = speeds[windAt.lower] as readonly number[]
    const highRow = speeds[windAt.upper] as readonly number[]
    return lerp(sample(lowRow, angleAt), sample(highRow, angleAt), windAt.t)
  }

  /**
   * Downwind targets are not in the table, so find them once per measured wind speed by
   * scanning for peak downwind VMG. Interpolating the result is close enough and keeps
   * every query O(1).
   */
  const runPoints: BeatPoint[] = windSpeeds.map((_, windIndex) => {
    const windAt: Bracket = { lower: windIndex, upper: windIndex, t: 0 }
    let best: BeatPoint = { angle: 180, vmg: 0 }
    for (let twa = 90; twa <= 180; twa += 0.5) {
      const vmg = tableSpeed(twa, windAt) * -Math.cos(toRadians(twa))
      if (vmg > best.vmg) best = { angle: twa, vmg }
    }
    return best
  })
  const runAngles = runPoints.map((point) => point.angle)
  const runVmgs = runPoints.map((point) => point.vmg)

  const maxSpeeds = speeds.map((row) => Math.max(...row))

  const boatSpeed = (twa: Degrees, tws: Knots): Knots => {
    const absTwa = Math.abs(normalizeSigned(twa))
    const windAt = bracket(windSpeeds, Math.max(0, tws))

    if (absTwa >= firstAngle) return tableSpeed(absTwa, windAt)

    // Closer to the wind than the table goes. Anchor on the beat target, where the boat
    // sails as fast as it usefully can, and taper to a standstill head to wind.
    const beatAngle = sample(beatAngles, windAt)
    const beatSpeed = sample(beatVmgs, windAt) / Math.cos(toRadians(beatAngle))

    if (absTwa <= beatAngle) {
      /*
       * Pinching: gentle for the first degree or two and then away to nothing where her
       * sails stall. Tapering all the way to zero at head to wind instead spread the loss
       * evenly over forty degrees, which put five per cent of her speed on the very first
       * one — a touch on the tiller cost three per cent and twelve seconds to win back.
       *
       * How fast it may fall at the top is not a choice. The table's beat angle is the
       * angle of best VMG, and VMG is speed times the cosine of the angle, so the speed
       * curve has to fall away there at exactly the tangent of that angle for the peak to
       * land where the table says it does. Flatter and her best VMG would lie above the
       * beat angle, steeper and it would lie below.
       */
      const stall = beatAngle * STALL_FRACTION
      if (absTwa <= stall) return 0
      const span = beatAngle - stall
      const slope = Math.tan(toRadians(beatAngle)) * (Math.PI / 180)
      const curve = (1 - slope * span) / (span * span)
      const pinch = beatAngle - absTwa
      return beatSpeed * Math.max(0, 1 - slope * pinch - curve * pinch * pinch)
    }
    return lerp(
      beatSpeed,
      tableSpeed(firstAngle, windAt),
      (absTwa - beatAngle) / (firstAngle - beatAngle),
    )
  }

  return {
    name: table.name,
    table,
    boatSpeed,
    vmg: (twa, tws) => boatSpeed(twa, tws) * Math.cos(toRadians(normalizeSigned(twa))),
    beatAngle: (tws) => sample(beatAngles, bracket(windSpeeds, tws)),
    runAngle: (tws) => sample(runAngles, bracket(windSpeeds, tws)),
    beatTarget(tws) {
      const at = bracket(windSpeeds, tws)
      const angle = sample(beatAngles, at)
      const vmg = sample(beatVmgs, at)
      return { angle, vmg, speed: vmg / Math.cos(toRadians(angle)) }
    },
    runTarget(tws) {
      const at = bracket(windSpeeds, tws)
      const angle = sample(runAngles, at)
      const vmg = sample(runVmgs, at)
      return { angle, vmg, speed: vmg / -Math.cos(toRadians(angle)) }
    },
    maxSpeed: (tws) => sample(maxSpeeds, bracket(windSpeeds, tws)),
  }
}

export function clampToTableWind(table: PolarTable, tws: Knots): Knots {
  const first = table.windSpeeds[0] as number
  const last = table.windSpeeds[table.windSpeeds.length - 1] as number
  return clamp(tws, first, last)
}
