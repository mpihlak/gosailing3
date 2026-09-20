import { add, distance, lerpVec, scale, sub, type Vec2 } from '@/foundation/geom'
import { clamp, type Meters, type Seconds } from '@/foundation/units'
import type { Bounds } from '@/domain/course'

/** Size of the drawing surface in CSS pixels. */
export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/**
 * The one place that knows about pixels. World space has y pointing north; the screen
 * has y pointing down, and that flip happens here and nowhere else.
 */
export interface Camera {
  /** The world point at the middle of the view. */
  readonly center: Vec2
  readonly pixelsPerMeter: number
  readonly viewport: Viewport
}

export function worldToScreen(camera: Camera, point: Vec2): ScreenPoint {
  const { center, pixelsPerMeter, viewport } = camera
  return {
    x: viewport.width / 2 + (point.x - center.x) * pixelsPerMeter,
    y: viewport.height / 2 - (point.y - center.y) * pixelsPerMeter,
  }
}

export function screenToWorld(camera: Camera, point: ScreenPoint): Vec2 {
  const { center, pixelsPerMeter, viewport } = camera
  return {
    x: center.x + (point.x - viewport.width / 2) / pixelsPerMeter,
    y: center.y - (point.y - viewport.height / 2) / pixelsPerMeter,
  }
}

export function metersToPixels(camera: Camera, meters: Meters): number {
  return meters * camera.pixelsPerMeter
}

/** The patch of water currently on screen. */
export function visibleBounds(camera: Camera): Bounds {
  const halfWidth = camera.viewport.width / 2 / camera.pixelsPerMeter
  const halfHeight = camera.viewport.height / 2 / camera.pixelsPerMeter
  return {
    min: { x: camera.center.x - halfWidth, y: camera.center.y - halfHeight },
    max: { x: camera.center.x + halfWidth, y: camera.center.y + halfHeight },
  }
}

export function isVisible(camera: Camera, point: Vec2, margin: Meters = 0): boolean {
  const bounds = visibleBounds(camera)
  return (
    point.x >= bounds.min.x - margin &&
    point.x <= bounds.max.x + margin &&
    point.y >= bounds.min.y - margin &&
    point.y <= bounds.max.y + margin
  )
}

/**
 * How much water to show. A phone gets a closer view than a laptop, because a boat
 * three pixels long is no use to anyone, and scrolls instead of shrinking the fleet.
 */
export function zoomFor(viewport: Viewport, desiredMetersAcross: Meters): number {
  const shortestEdge = Math.min(viewport.width, viewport.height)
  return shortestEdge / desiredMetersAcross
}

/**
 * Never draw a boat smaller than this, whatever else the zoom would like. On a phone
 * held upright the short edge is the width, and asking for four hundred meters across it
 * left a ten meter boat ten pixels long.
 */
export interface BoatFloor {
  readonly boatLength: Meters
  readonly leastPixels: number
}

export function zoomForBoats(
  viewport: Viewport,
  desiredMetersAcross: Meters,
  floor?: BoatFloor,
): number {
  const water = zoomFor(viewport, desiredMetersAcross)
  if (!floor || floor.boatLength <= 0) return water
  return Math.max(water, floor.leastPixels / floor.boatLength)
}

export function createCamera(
  viewport: Viewport,
  center: Vec2,
  desiredMetersAcross: Meters,
  floor?: BoatFloor,
): Camera {
  return { center, viewport, pixelsPerMeter: zoomForBoats(viewport, desiredMetersAcross, floor) }
}

/** Zoom that fits an area entirely on screen, for an overview or a small course. */
export function zoomToFit(bounds: Bounds, viewport: Viewport, padding = 40): number {
  const width = Math.max(1, bounds.max.x - bounds.min.x)
  const height = Math.max(1, bounds.max.y - bounds.min.y)
  return Math.min(
    (viewport.width - padding * 2) / width,
    (viewport.height - padding * 2) / height,
  )
}

export function centerOf(bounds: Bounds): Vec2 {
  return lerpVec(bounds.min, bounds.max, 0.5)
}

/**
 * Keep the view inside the racing area. When the course is smaller than the screen in
 * one direction, center it rather than pinning it to an edge.
 */
export function clampToBounds(camera: Camera, bounds: Bounds): Camera {
  const half = {
    x: camera.viewport.width / 2 / camera.pixelsPerMeter,
    y: camera.viewport.height / 2 / camera.pixelsPerMeter,
  }
  const clampAxis = (value: number, min: number, max: number, halfSpan: number): number =>
    max - min <= halfSpan * 2 ? (min + max) / 2 : clamp(value, min + halfSpan, max - halfSpan)

  return {
    ...camera,
    center: {
      x: clampAxis(camera.center.x, bounds.min.x, bounds.max.x, half.x),
      y: clampAxis(camera.center.y, bounds.min.y, bounds.max.y, half.y),
    },
  }
}

export interface FollowOptions {
  /** Fraction of the view the target may wander in before the camera moves at all. */
  readonly deadzone?: number
  /** Seconds for the camera to close most of the remaining distance. */
  readonly smoothing?: Seconds
  /** Push the view this far ahead of the boat, so you see where you are going. */
  readonly lead?: Vec2
  readonly bounds?: Bounds
}

/**
 * Ease the camera toward a boat. The deadzone keeps the view still while the boat
 * wanders about the middle of the screen, which matters on a small display where
 * constant scrolling is hard to read.
 */
export function follow(
  camera: Camera,
  target: Vec2,
  dt: Seconds,
  options: FollowOptions = {},
): Camera {
  const { deadzone = 0.25, smoothing = 0.6, lead, bounds } = options
  const desired = lead ? add(target, lead) : target

  const halfWidth = camera.viewport.width / 2 / camera.pixelsPerMeter
  const halfHeight = camera.viewport.height / 2 / camera.pixelsPerMeter
  const offset = sub(desired, camera.center)

  const slackX = halfWidth * deadzone
  const slackY = halfHeight * deadzone
  const pull = {
    x: Math.abs(offset.x) <= slackX ? 0 : offset.x - Math.sign(offset.x) * slackX,
    y: Math.abs(offset.y) <= slackY ? 0 : offset.y - Math.sign(offset.y) * slackY,
  }
  if (pull.x === 0 && pull.y === 0) return bounds ? clampToBounds(camera, bounds) : camera

  const t = smoothing <= 0 ? 1 : 1 - Math.exp(-dt / smoothing)
  const moved: Camera = { ...camera, center: add(camera.center, scale(pull, t)) }
  return bounds ? clampToBounds(moved, bounds) : moved
}

/** Distance in meters that one screen pixel covers, for hit testing and line widths. */
export function pixelSize(camera: Camera): Meters {
  return 1 / camera.pixelsPerMeter
}

export function distanceOnScreen(camera: Camera, a: Vec2, b: Vec2): number {
  return distance(a, b) * camera.pixelsPerMeter
}
