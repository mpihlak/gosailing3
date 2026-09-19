import {
  distanceToSegment,
  dot,
  normalize,
  perpendicular,
  segmentCrossing,
  sub,
  vectorToBearing,
  lerpVec,
  type Vec2,
} from '@/foundation/geom'
import type { Degrees, Meters } from '@/foundation/units'
import type { RaceLine } from './types'

/**
 * Build a line between two ends, oriented so that a boat travelling toward `towards`
 * crosses it the legal way. Start and finish can be the same water with opposite
 * orientations, which is exactly what a windward-leeward course wants.
 */
export function createLine(
  id: string,
  name: string,
  from: Vec2,
  to: Vec2,
  towards: Vec2,
): RaceLine {
  const alongLine = sub(to, from)
  const candidate = normalize(perpendicular(alongLine))
  const midpoint = lerpVec(from, to, 0.5)
  const facing = dot(sub(towards, midpoint), candidate) >= 0 ? 1 : -1
  return {
    id,
    name,
    from,
    to,
    normal: { x: candidate.x * facing, y: candidate.y * facing },
  }
}

export function lineMidpoint(line: RaceLine): Vec2 {
  return lerpVec(line.from, line.to, 0.5)
}

export function lineLength(line: RaceLine): Meters {
  return Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
}

/** Positive on the side the normal points to, negative behind the line. */
export function sideOfLine(line: RaceLine, point: Vec2): number {
  return dot(sub(point, line.from), line.normal)
}

export function distanceToLine(line: RaceLine, point: Vec2): Meters {
  return distanceToSegment({ from: line.from, to: line.to }, point)
}

export type LineCrossing = 'forward' | 'backward'

/**
 * Whether a path across the line passed between the ends, and which way it went.
 * A boat that drifts back over the start line before the gun needs to be caught, so
 * a backward crossing is reported rather than ignored.
 */
export function crossedLine(line: RaceLine, from: Vec2, to: Vec2): LineCrossing | null {
  const crossing = segmentCrossing(from, to, { from: line.from, to: line.to })
  if (!crossing) return null
  return dot(sub(to, from), line.normal) >= 0 ? 'forward' : 'backward'
}

export interface LineBias {
  readonly favored: 'pin' | 'committee' | 'even'
  /** How far the line is from square to the wind, in degrees. */
  readonly angle: Degrees
}

/**
 * Which end of the line is closer to the wind. A biased line is the first tactical
 * decision of a race, so the instruments and the AI both need this number.
 */
export function lineBias(line: RaceLine, windDirection: Degrees, evenWithin: Degrees = 2): LineBias {
  const upwind = { x: Math.sin((windDirection * Math.PI) / 180), y: Math.cos((windDirection * Math.PI) / 180) }
  const advantage = dot(sub(line.from, line.to), upwind)
  const length = lineLength(line)
  if (length === 0) return { favored: 'even', angle: 0 }

  const angle = Math.abs((Math.asin(Math.max(-1, Math.min(1, advantage / length))) * 180) / Math.PI)
  if (angle < evenWithin) return { favored: 'even', angle }
  return { favored: advantage > 0 ? 'pin' : 'committee', angle }
}

export function lineBearing(line: RaceLine): Degrees {
  return vectorToBearing(sub(line.to, line.from))
}
