import { visibleBounds, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

/**
 * Open water and a grid of hundred-meter squares. Without the grid there is nothing to
 * judge motion against, and the boat looks becalmed even at hull speed.
 */
export function drawWater(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const { width, height } = camera.viewport

  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, PALETTE.waterDeep)
  gradient.addColorStop(1, PALETTE.water)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const spacing = gridSpacing(camera.pixelsPerMeter)
  const view = visibleBounds(camera)
  ctx.lineWidth = 1

  for (let x = Math.ceil(view.min.x / spacing) * spacing; x <= view.max.x; x += spacing) {
    ctx.strokeStyle = x % (spacing * 5) === 0 ? PALETTE.gridMajor : PALETTE.grid
    const screen = worldToScreen(camera, { x, y: 0 })
    line(ctx, screen.x, 0, screen.x, height)
  }
  for (let y = Math.ceil(view.min.y / spacing) * spacing; y <= view.max.y; y += spacing) {
    ctx.strokeStyle = y % (spacing * 5) === 0 ? PALETTE.gridMajor : PALETTE.grid
    const screen = worldToScreen(camera, { x: 0, y })
    line(ctx, 0, screen.y, width, screen.y)
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
