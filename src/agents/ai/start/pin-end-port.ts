import {
  add,
  angleDelta,
  bearingToVector,
  dot,
  normalize,
  normalizeBearing,
  scale,
  sub,
  vectorToBearing,
  type Vec2,
} from '@/foundation/geom'
import { toRadians } from '@/foundation/geom'
import { knotsToMps, type Degrees, type Meters, type Seconds } from '@/foundation/units'
import { bowPosition } from '@/domain/boat'
import { sideOfLine } from '@/domain/course'
import type { StartContext, StartPlan, StartStrategy } from './types'

export interface PinEndPortOptions {
  /** How far up the line from the pin to aim, in boat lengths. Keeps her off the mark. */
  readonly clearance?: number
  /** Time allowed to get round from reaching out onto the approach. */
  readonly turnAllowance?: Seconds
  /** Most she will bear away to lose time. Beyond this she is simply too early. */
  readonly maxBurn?: Degrees
  /** How far from the line she will reach out. Keeps a long countdown from wandering. */
  readonly maxReach?: Meters
}

const DEFAULTS = {
  clearance: 1.6,
  turnAllowance: 6,
  maxBurn: 35,
  maxReach: 320,
} as const

/**
 * A port tack start at the pin.
 *
 * She reaches away from the line while she has time in hand, turns, and comes back
 * close-hauled on port to cross just to windward of the pin as the gun goes. The point
 * she reaches out to is on the layline she will come back up, so the turn puts her on
 * the approach rather than across it, and it slides toward the line as the clock runs
 * down — when it reaches the line, so should she.
 *
 * TODO: she takes no account of right of way and will sail through anyone in her way.
 * TODO: nor of being over early despite all this; she needs to bear off, return and
 * start again.
 * TODO: a big shift can leave the pin unlayable on port, and she will sail at it anyway.
 * TODO: bearing away spends time by running up the line, so a countdown too short to
 * reach out in leaves her nowhere to put it. That case wants a timed run instead.
 */
export function pinEndPortStart(options: PinEndPortOptions = {}): StartStrategy {
  const { clearance, turnAllowance, maxBurn, maxReach } = {
    ...DEFAULTS,
    ...options,
  }

  return {
    name: 'pin end, port tack',

    plan(context: StartContext): StartPlan {
      const { boat, spec, wind, timeToStart, gunFired } = context
      // Close-hauled on port: the wind on her port side, so her heading is the wind
      // direction plus the angle she can hold.
      const closeHauled = normalizeBearing(wind.direction + spec.polar.beatAngle(wind.speed))

      const target = startPoint(context, clearance * spec.length)
      const closeHauledSpeed = knotsToMps(spec.polar.beatTarget(wind.speed).speed)
      // Reach out for as long as there is a turning point she can still get back from.
      // When there is none left, the time is gone and the approach begins.
      const away = gunFired
        ? null
        : turnPoint(context, target, closeHauled, closeHauledSpeed, turnAllowance, maxReach)
      if (away) return { bearing: vectorToBearing(sub(away, boat.position)), phase: 'reaching' }

      /*
       * On the approach now, and what has to be timed is the crossing, not the arrival
       * at the pin. Those are not the same thing: close-hauled from well down the line
       * she meets the line long before she gets anywhere near the pin, and timing the
       * pin alone had her over the line early while still believing she was late.
       *
       * Bearing away is what buys the time, so the question is how far off the wind she
       * has to sail for the crossing to land on the gun. Solved rather than fed back,
       * because the angle changes her speed, which changes the crossing, which changes
       * the angle.
       */
      /*
       * Two reasons to bear away, and she takes whichever asks for more. One is the
       * clock. The other is the pin: overstand the layline and close-hauled on port
       * carries her across the line's extension outside the pin, which is no start at
       * all. Bearing away moves her crossing back up the line and inside the mark.
       */
      const burn = Math.min(
        maxBurn,
        Math.max(
          burnToDelay(context, closeHauled, timeToStart, maxBurn),
          burnToClearPin(context, closeHauled, clearance * spec.length, maxBurn),
        ),
      )

      // Past the gun there is nothing left to time: she is simply sailing at the line as
      // fast as she can.
      return {
        bearing: normalizeBearing(closeHauled + burn),
        phase: gunFired ? 'onTheWind' : burn > 1 ? 'burning' : 'approaching',
      }
    },
  }
}

/**
 * How long until her bow reaches the line, were she sailing this bearing. Only the part
 * of her speed square to the line closes it, which is why bearing away buys time — and
 * the speed is the polar speed for that bearing, because bearing away makes her faster
 * at the same time as it points her less at the line.
 */
function timeToCross(context: StartContext, bearing: Degrees): Seconds {
  const { boat, spec, line, wind } = context
  const behind = -sideOfLine(line, bowPosition(boat, spec))
  if (behind <= 0) return 0

  const speed = knotsToMps(spec.polar.boatSpeed(angleDelta(wind.direction, bearing), wind.speed))
  const closing = speed * Math.cos(toRadians(angleDelta(vectorToBearing(line.normal), bearing)))
  return closing > 0.05 ? behind / closing : Infinity
}

/**
 * How far off the wind she must sail for her crossing to land on the gun. Nothing if she
 * is already late, and no more than the cap if even that is not enough — which is the
 * case she cannot save, and sails over early.
 */
function burnToDelay(
  context: StartContext,
  closeHauled: Degrees,
  timeToStart: Seconds,
  maxBurn: Degrees,
): Degrees {
  if (timeToCross(context, closeHauled) >= timeToStart) return 0
  if (timeToCross(context, closeHauled + maxBurn) <= timeToStart) return maxBurn

  // Bearing away always delays the crossing, so the answer is bracketed and the search
  // is a bisection.
  let low = 0
  let high = maxBurn
  for (let i = 0; i < 18; i++) {
    const middle = (low + high) / 2
    if (timeToCross(context, closeHauled + middle) < timeToStart) low = middle
    else high = middle
  }
  return high
}

/** Where on the line she means to cross: up from the pin, clear of it. */
function startPoint(context: StartContext, clearance: Meters): Vec2 {
  const { line } = context
  const upTheLine = normalize(sub(line.to, line.from))
  return add(line.from, scale(upTheLine, clearance))
}

/**
 * Where to turn.
 *
 * Getting back to the line is two legs, not one: out to a point on the layline, and then
 * up the layline close-hauled. Both take time, and the further out she goes the longer
 * both become. This finds the turning point where the two together use up exactly the
 * time that is left.
 *
 * An earlier version placed the turn at the distance she could sail close-hauled in the
 * time remaining, which counted the second leg and ignored the first. She ran out of
 * time a hundred meters inside the layline, turned anyway, and could not fetch the pin
 * from there.
 */
function turnPoint(
  context: StartContext,
  target: Vec2,
  closeHauled: Degrees,
  closeHauledSpeed: number,
  turnAllowance: Seconds,
  maxReach: Meters,
): Vec2 | null {
  const { boat, spec, wind, timeToStart } = context
  // Coming round from a reach onto the wind costs her a few seconds of progress.
  const budget = timeToStart - turnAllowance
  if (budget <= 0) return null
  const downTheLayline = bearingToVector(normalizeBearing(closeHauled + 180))

  const at = (back: Meters): Vec2 => add(target, scale(downTheLayline, back))

  /** Time to sail out to the turning point and then up the layline from it. */
  const timeVia = (back: Meters): Seconds => {
    const turn = at(back)
    const out = sub(turn, boat.position)
    const reach = Math.hypot(out.x, out.y)
    if (reach < 1) return back / closeHauledSpeed

    const twa = angleDelta(wind.direction, vectorToBearing(out))
    const reachingSpeed = Math.max(
      closeHauledSpeed,
      knotsToMps(spec.polar.boatSpeed(twa, wind.speed)),
    )
    return reach / reachingSpeed + back / closeHauledSpeed
  }

  // Going out costs time and so does coming back, so the further out the turn, the later
  // she gets to the line. That makes the search a simple bisection.
  let near = 0
  let far = Math.min(closeHauledSpeed * budget, maxReach)
  if (timeVia(far) <= budget) return at(far)

  for (let i = 0; i < 24; i++) {
    const middle = (near + far) / 2
    if (timeVia(middle) <= budget) near = middle
    else far = middle
  }
  /*
   * Below a boat length there is nothing left to reach out for, and the approach — which
   * knows how to bear away and wait — takes over.
   */
  return near < spec.length ? null : at(near)
}

/** Where her bow meets the line on a given bearing, or null if that course never does. */
function crossingPoint(context: StartContext, bearing: Degrees): Vec2 | null {
  const { boat, spec, line } = context
  const bow = bowPosition(boat, spec)
  const behind = -sideOfLine(line, bow)
  if (behind <= 0) return null

  const along = bearingToVector(bearing)
  const closing = dot(along, line.normal)
  return closing > 0.01 ? add(bow, scale(along, behind / closing)) : null
}

/** How far up the line from the pin a point lies. Negative is outside the pin. */
function upTheLine(line: StartContext['line'], point: Vec2): Meters {
  return dot(sub(point, line.from), normalize(sub(line.to, line.from)))
}

/**
 * How far off the wind she must sail for her crossing to fall inside the pin rather than
 * outside it. Nothing if she is already fetching it, and no more than the cap if even
 * that will not do — which is the shift she cannot answer.
 */
function burnToClearPin(
  context: StartContext,
  closeHauled: Degrees,
  clearance: Meters,
  maxBurn: Degrees,
): Degrees {
  const crossesAt = (burn: Degrees): Meters => {
    const point = crossingPoint(context, closeHauled + burn)
    return point ? upTheLine(context.line, point) : Infinity
  }

  if (crossesAt(0) >= clearance) return 0
  if (crossesAt(maxBurn) < clearance) return maxBurn

  // Bearing away always moves the crossing further up the line, so this is bracketed.
  let low = 0
  let high = maxBurn
  for (let i = 0; i < 18; i++) {
    const middle = (low + high) / 2
    if (crossesAt(middle) < clearance) low = middle
    else high = middle
  }
  return high
}
