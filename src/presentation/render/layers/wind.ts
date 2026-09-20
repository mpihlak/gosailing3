import { toRadians } from '@/foundation/geom'
import { clamp } from '@/foundation/units'
import type { Vec2 } from '@/foundation/geom'
import type { WindSample } from '@/domain/wind'
import { visibleBounds, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

/**
 * Arrows sampled across the view. They are the only way to see a gust coming or to read
 * which side of the course is paying, so they are drawn as part of the water rather
 * than as an instrument.
 */
export function drawWindField(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  /** The wind anywhere on the course, shadows and all: the arrows show what is sailed in. */
  sample: (at: Vec2) => WindSample,
  medianSpeed: number,
): void {
  const view = visibleBounds(camera)
  const columns = 7
  const stepX = (view.max.x - view.min.x) / columns
  const stepY = stepX
  // A canvas with no area would step nowhere, and the loop below would never end.
  if (!(stepX > 0)) return

  ctx.save()
  ctx.lineCap = 'round'

  for (let x = view.min.x + stepX / 2; x < view.max.x; x += stepX) {
    for (let y = view.min.y + stepY / 2; y < view.max.y; y += stepY) {
      const here = sample({ x, y })
      const screen = worldToScreen(camera, { x, y })
      const relative = clamp(here.speed / Math.max(medianSpeed, 1), 0.5, 1.6)

      ctx.save()
      ctx.translate(screen.x, screen.y)
      // Arrows point the way the wind is going, which is away from where it comes from.
      ctx.rotate(toRadians(here.direction + 180))
      ctx.strokeStyle = relative > 1.12 ? PALETTE.windStrong : PALETTE.wind
      ctx.lineWidth = relative > 1.12 ? 2 : 1.4

      const length = 14 * relative
      ctx.beginPath()
      ctx.moveTo(0, length / 2)
      ctx.lineTo(0, -length / 2)
      ctx.moveTo(-3.5, -length / 2 + 5)
      ctx.lineTo(0, -length / 2)
      ctx.lineTo(3.5, -length / 2 + 5)
      ctx.stroke()
      ctx.restore()
    }
  }
  ctx.restore()
}
