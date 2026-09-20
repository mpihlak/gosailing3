import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { vec } from '@/foundation/geom'
import {
  clampToBounds,
  zoomForBoats,
  createCamera,
  follow,
  screenToWorld,
  visibleBounds,
  worldToScreen,
  zoomFor,
  zoomToFit,
  type Camera,
} from './camera'

const VIEWPORT = { width: 1200, height: 800 }
const CAMERA: Camera = { center: vec(0, 0), pixelsPerMeter: 2, viewport: VIEWPORT }
const COURSE_BOUNDS = { min: vec(-500, -200), max: vec(500, 1100) }

describe('worldToScreen', () => {
  it('puts the camera center in the middle of the screen', () => {
    expect(worldToScreen(CAMERA, vec(0, 0))).toEqual({ x: 600, y: 400 })
  })

  it('flips north onto screen-up', () => {
    expect(worldToScreen(CAMERA, vec(0, 100)).y).toBeLessThan(400)
    expect(worldToScreen(CAMERA, vec(0, -100)).y).toBeGreaterThan(400)
  })

  it('leaves east as screen-right', () => {
    expect(worldToScreen(CAMERA, vec(100, 0)).x).toBeGreaterThan(600)
  })

  it('scales by the zoom', () => {
    expect(worldToScreen(CAMERA, vec(50, 0)).x).toBe(600 + 100)
  })

  it('round-trips through screenToWorld', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (x, y) => {
          const back = screenToWorld(CAMERA, worldToScreen(CAMERA, vec(x, y)))
          expect(back.x).toBeCloseTo(x, 6)
          expect(back.y).toBeCloseTo(y, 6)
        },
      ),
    )
  })
})

describe('zoom', () => {
  it('shows the requested stretch of water across the short edge', () => {
    const camera = createCamera(VIEWPORT, vec(0, 0), 400)
    expect(camera.pixelsPerMeter).toBe(2) // 800px tall over 400m
    const view = visibleBounds(camera)
    expect(view.max.y - view.min.y).toBeCloseTo(400)
  })

  it('zooms in further on a narrow phone than on a laptop', () => {
    const phone = zoomFor({ width: 390, height: 844 }, 400)
    const laptop = zoomFor({ width: 1440, height: 900 }, 400)
    expect(phone).toBeLessThan(laptop)
  })

  it('fits a whole course when asked to', () => {
    const zoom = zoomToFit(COURSE_BOUNDS, VIEWPORT)
    const camera: Camera = { center: vec(0, 450), pixelsPerMeter: zoom, viewport: VIEWPORT }
    const view = visibleBounds(camera)
    expect(view.min.x).toBeLessThanOrEqual(COURSE_BOUNDS.min.x)
    expect(view.max.y).toBeGreaterThanOrEqual(COURSE_BOUNDS.max.y)
  })
})

describe('clampToBounds', () => {
  it('stops the view running off the edge of the course', () => {
    const camera: Camera = { ...CAMERA, center: vec(5000, 5000) }
    const clamped = clampToBounds(camera, COURSE_BOUNDS)
    const view = visibleBounds(clamped)
    expect(view.max.x).toBeLessThanOrEqual(COURSE_BOUNDS.max.x + 0.001)
    expect(view.max.y).toBeLessThanOrEqual(COURSE_BOUNDS.max.y + 0.001)
  })

  it('centers an axis the view is already wider than', () => {
    // 1200px at 2px/m shows 600m, wider than the 1000m course is... not quite; zoom out.
    const wide: Camera = { ...CAMERA, pixelsPerMeter: 0.5, center: vec(400, 0) }
    const clamped = clampToBounds(wide, COURSE_BOUNDS)
    expect(clamped.center.x).toBeCloseTo(0) // the middle of the course
  })
})

describe('follow', () => {
  it('stays put while the boat wanders about the middle', () => {
    const camera = createCamera(VIEWPORT, vec(0, 0), 400)
    expect(follow(camera, vec(10, 10), 1 / 60).center).toEqual(camera.center)
  })

  it('starts moving once the boat leaves the deadzone', () => {
    const camera = createCamera(VIEWPORT, vec(0, 0), 400)
    const moved = follow(camera, vec(0, 180), 1 / 60)
    expect(moved.center.y).toBeGreaterThan(0)
  })

  it('catches up smoothly rather than snapping', () => {
    const camera = createCamera(VIEWPORT, vec(0, 0), 400)
    const target = vec(0, 400)
    const oneStep = follow(camera, target, 1 / 60)
    expect(oneStep.center.y).toBeLessThan(100) // nowhere near there yet

    let settled = camera
    for (let i = 0; i < 60 * 5; i++) settled = follow(settled, target, 1 / 60)
    expect(settled.center.y).toBeGreaterThan(300)
  })

  it('respects the course bounds while following', () => {
    const camera = createCamera(VIEWPORT, vec(0, 1000), 400)
    let settled = camera
    for (let i = 0; i < 600; i++) {
      settled = follow(settled, vec(0, 5000), 1 / 60, { bounds: COURSE_BOUNDS })
    }
    expect(visibleBounds(settled).max.y).toBeLessThanOrEqual(COURSE_BOUNDS.max.y + 0.001)
  })

  it('leads the view in the direction of travel when asked', () => {
    const camera = createCamera(VIEWPORT, vec(0, 0), 400)
    const withLead = follow(camera, vec(0, 120), 1, { lead: vec(0, 150) })
    const without = follow(camera, vec(0, 120), 1)
    expect(withLead.center.y).toBeGreaterThan(without.center.y)
  })
})

describe('zoomForBoats', () => {
  const BOAT = 10.7
  const floor = { boatLength: BOAT, leastPixels: 20 }

  it('leaves a big screen alone', () => {
    // There is room for the water asked for, and the boat is big enough anyway.
    expect(zoomForBoats(VIEWPORT, 420, floor)).toBeCloseTo(zoomFor(VIEWPORT, 420))
  })

  it('stops a boat shrinking to nothing on a phone held upright', () => {
    const phone = { width: 390, height: 844 }
    // Four hundred meters across three hundred and ninety pixels is a ten pixel boat.
    expect(zoomFor(phone, 420) * BOAT).toBeLessThan(11)
    expect(zoomForBoats(phone, 420, floor) * BOAT).toBeGreaterThanOrEqual(20)
  })

  it('shows less water rather than a smaller boat', () => {
    const phone = { width: 390, height: 844 }
    const camera = { center: vec(0, 0), pixelsPerMeter: zoomForBoats(phone, 420, floor), viewport: phone }
    const view = visibleBounds(camera)
    expect(view.max.x - view.min.x).toBeLessThan(420)
    expect(view.max.x - view.min.x).toBeGreaterThan(150)
  })

  it('does nothing without a boat to measure against', () => {
    expect(zoomForBoats(VIEWPORT, 420)).toBe(zoomFor(VIEWPORT, 420))
  })
})
