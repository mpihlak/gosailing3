import type { Meters } from '@/foundation/units'
import type { Vec2 } from './vec'
import { cross, dot, lengthSq, sub, add, scale } from './vec'

export interface Segment {
  readonly from: Vec2
  readonly to: Vec2
}

/**
 * Which side of the directed line a→b the point lies on.
 * Positive is left of the direction of travel, negative is right, zero is on the line.
 */
export function sideOfLine(a: Vec2, b: Vec2, point: Vec2): number {
  return cross(sub(b, a), sub(point, a))
}

/** Closest point on the segment, clamped to its ends. */
export function closestPointOnSegment(segment: Segment, point: Vec2): Vec2 {
  const span = sub(segment.to, segment.from)
  const lenSq = lengthSq(span)
  if (lenSq === 0) return segment.from
  const t = Math.max(0, Math.min(1, dot(sub(point, segment.from), span) / lenSq))
  return add(segment.from, scale(span, t))
}

export function distanceToSegment(segment: Segment, point: Vec2): Meters {
  const closest = closestPointOnSegment(segment, point)
  return Math.hypot(point.x - closest.x, point.y - closest.y)
}

export interface Crossing {
  /** Fraction along the moving path where the crossing happened, 0 to 1. */
  readonly t: number
  /** Fraction along the crossed segment, 0 to 1. */
  readonly u: number
  readonly point: Vec2
  /** Sign of the side the path came from: positive means it crossed right to left. */
  readonly direction: number
}

/**
 * Where a path from `pathStart` to `pathEnd` crosses a segment, or null if it does not.
 * Used for start and finish lines, so it reports which way the crossing went: a boat
 * that drifts back over the line must be detectable as going the wrong way.
 */
export function segmentCrossing(
  pathStart: Vec2,
  pathEnd: Vec2,
  segment: Segment,
): Crossing | null {
  const path = sub(pathEnd, pathStart)
  const line = sub(segment.to, segment.from)
  const denominator = cross(path, line)
  if (denominator === 0) return null // parallel, including both degenerate cases

  const offset = sub(segment.from, pathStart)
  const t = cross(offset, line) / denominator
  const u = cross(offset, path) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null

  return {
    t,
    u,
    point: add(pathStart, scale(path, t)),
    direction: Math.sign(sideOfLine(segment.from, segment.to, pathStart)),
  }
}

export interface ClosestPoints {
  readonly distance: Meters
  readonly onFirst: Vec2
  readonly onSecond: Vec2
}

/**
 * The nearest points on two segments, and how far apart they are. A hull is long and
 * thin, so treating it as its centreline plus a radius measures contact far better than
 * a circle around its middle does.
 *
 * Follows the standard clamped-parameter solution: solve for the closest points on the
 * infinite lines, clamp each to its segment, and re-solve the other against the clamp.
 */
export function closestBetweenSegments(first: Segment, second: Segment): ClosestPoints {
  const EPSILON = 1e-12
  const d1 = sub(first.to, first.from)
  const d2 = sub(second.to, second.from)
  const between = sub(first.from, second.from)

  const len1 = lengthSq(d1)
  const len2 = lengthSq(d2)
  const projected2 = dot(d2, between)

  let s = 0
  let t = 0

  if (len1 <= EPSILON && len2 <= EPSILON) {
    // Both degenerate to points.
  } else if (len1 <= EPSILON) {
    t = clampUnit(projected2 / len2)
  } else {
    const projected1 = dot(d1, between)
    if (len2 <= EPSILON) {
      s = clampUnit(-projected1 / len1)
    } else {
      const skew = dot(d1, d2)
      const denominator = len1 * len2 - skew * skew
      s = denominator !== 0 ? clampUnit((skew * projected2 - projected1 * len2) / denominator) : 0
      t = (skew * s + projected2) / len2
      if (t < 0) {
        t = 0
        s = clampUnit(-projected1 / len1)
      } else if (t > 1) {
        t = 1
        s = clampUnit((skew - projected1) / len1)
      }
    }
  }

  const onFirst = add(first.from, scale(d1, s))
  const onSecond = add(second.from, scale(d2, t))
  return { distance: Math.hypot(onFirst.x - onSecond.x, onFirst.y - onSecond.y), onFirst, onSecond }
}

function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
