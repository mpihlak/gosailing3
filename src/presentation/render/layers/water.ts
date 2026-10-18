import { add, bearingToVector, dot, scale, type Vec2 } from '@/foundation/geom'
import type { Degrees } from '@/foundation/units'
import { visibleBounds, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

/**
 * Open water and a grid of hundred-meter squares. Without the grid there is nothing to
 * judge motion against, and the boat looks becalmed even at hull speed.
 *
 * The grid is turned to the wind, a ladder: its rungs lie square to the wind and its
 * rails along it, so climbing a rung is distance made to windward.
 */
export function drawWater(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  windDirection: Degrees,
): void {
  const { width, height } = camera.viewport

  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, PALETTE.waterDeep)
  gradient.addColorStop(1, PALETTE.water)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const spacing = gridSpacing(camera.pixelsPerMeter)
  // Up the ladder is into the wind; across it is square to that.
  const up = bearingToVector(windDirection)
  const across = bearingToVector(windDirection + 90)
  const view = visibleBounds(camera)
  const corners: Vec2[] = [
    view.min,
    view.max,
    { x: view.min.x, y: view.max.y },
    { x: view.max.x, y: view.min.y },
  ]
  const span = (axis: Vec2) => {
    const along = corners.map((corner) => dot(corner, axis))
    return { from: Math.min(...along), to: Math.max(...along) }
  }
  const rise = span(up)
  const reach = span(across)
  const at = (a: number, b: number) => worldToScreen(camera, add(scale(up, a), scale(across, b)))
  ctx.lineWidth = 1

  // The rungs: square to the wind.
  for (let a = Math.ceil(rise.from / spacing) * spacing; a <= rise.to; a += spacing) {
    ctx.strokeStyle = a % (spacing * 5) === 0 ? PALETTE.gridMajor : PALETTE.grid
    const from = at(a, reach.from)
    const to = at(a, reach.to)
    line(ctx, from.x, from.y, to.x, to.y)
  }
  // The rails: along it.
  for (let b = Math.ceil(reach.from / spacing) * spacing; b <= reach.to; b += spacing) {
    ctx.strokeStyle = b % (spacing * 5) === 0 ? PALETTE.gridMajor : PALETTE.grid
    const from = at(rise.from, b)
    const to = at(rise.to, b)
    line(ctx, from.x, from.y, to.x, to.y)
  }
}

/** Keep grid squares between roughly 30 and 150 pixels however far the view is zoomed. */
function gridSpacing(pixelsPerMeter: number): number {
  const candidates = [10, 25, 50, 100, 250, 500]
  return candidates.find((meters) => meters * pixelsPerMeter >= 30) ?? 1000
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}
