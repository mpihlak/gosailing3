import type { Meters } from '@/foundation/units'

/** A point or displacement in world space: x east, y north, in meters. */
export interface Vec2 {
  readonly x: Meters
  readonly y: Meters
}

export const ORIGIN: Vec2 = { x: 0, y: 0 }

export function vec(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, y: v.y * factor }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

/** Z component of the 3D cross product. Positive when b lies counter-clockwise of a. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y
}

export function length(v: Vec2): Meters {
  return Math.hypot(v.x, v.y)
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function distance(a: Vec2, b: Vec2): Meters {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v)
  return len === 0 ? ORIGIN : { x: v.x / len, y: v.y / len }
}

/** Rotate 90 degrees counter-clockwise. */
export function perpendicular(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x }
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function equals(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}
