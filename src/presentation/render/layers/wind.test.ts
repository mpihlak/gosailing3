import { describe, it, expect } from 'vitest'
import type { Camera } from '@/presentation/view/camera'
import { drawWindField } from './wind'

/** Where each arrow was placed, which is the one thing this layer decides. */
function arrowsFor(camera: Camera): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = []
  const own: Record<string, unknown> = {}
  const ctx = new Proxy(own, {
    get(target, property: string) {
      if (property in target) return target[property]
      return (...args: unknown[]) => {
        if (property === 'translate') placed.push({ x: args[0] as number, y: args[1] as number })
        return undefined
      }
    },
    set(target, property: string, value) {
      target[property] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D

  drawWindField(ctx, camera, () => ({ direction: 0, speed: 12 }), 12)
  return placed
}

/** The two screens the game has to look right on, both at the zoom each one uses. */
const LAPTOP: Camera = {
  center: { x: 0, y: 0 },
  pixelsPerMeter: 2.14,
  viewport: { width: 1440, height: 900 },
}
const PHONE: Camera = {
  center: { x: 0, y: 0 },
  pixelsPerMeter: 1.87,
  viewport: { width: 390, height: 844 },
}

/** The gap between neighbours along a row, in pixels. */
function columnGap(arrows: { x: number; y: number }[]): number {
  const row = arrows.filter((arrow) => arrow.y === arrows[0]?.y).map((arrow) => arrow.x)
  expect(row.length).toBeGreaterThan(1)
  return (row[1] as number) - (row[0] as number)
}

describe('the wind arrows', () => {
  /*
   * A step taken as a fraction of the visible water made the spacing a function of the
   * window's shape. The phone, which shows about a third of the width the laptop does,
   * got them three times closer together and the water disappeared under them.
   */
  it('spaces them the same on a phone as on a laptop', () => {
    expect(columnGap(arrowsFor(PHONE))).toBeCloseTo(columnGap(arrowsFor(LAPTOP)), 6)
  })

  it('spaces the rows as widely as the columns', () => {
    const arrows = arrowsFor(LAPTOP)
    const column = arrows.filter((arrow) => arrow.x === arrows[0]?.x).map((arrow) => arrow.y)
    expect(Math.abs((column[1] as number) - (column[0] as number))).toBeCloseTo(
      columnGap(arrows),
      6,
    )
  })

  it('covers the screen without burying it', () => {
    for (const camera of [LAPTOP, PHONE]) {
      const arrows = arrowsFor(camera)
      const { width, height } = camera.viewport
      expect(arrows.length).toBeGreaterThanOrEqual(Math.floor(width / 260) * Math.floor(height / 260))
      expect(arrows.length).toBeLessThanOrEqual(Math.ceil(width / 150) * Math.ceil(height / 150))
    }
  })

  it('draws nothing rather than hanging when the camera has no zoom', () => {
    expect(arrowsFor({ ...LAPTOP, pixelsPerMeter: 0 })).toHaveLength(0)
  })
})
