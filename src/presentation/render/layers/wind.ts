import { toRadians } from '@/foundation/geom'
import { clamp } from '@/foundation/units'
import type { Vec2 } from '@/foundation/geom'
import type { WindSample } from '@/domain/wind'
import { visibleBounds, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

/**
 * How far apart the arrows are drawn, measured on the screen rather than on the water.
 *
 * Stepping by a fraction of the visible water instead tied the spacing to the shape of
 * the window. A phone, zoomed in far enough to keep the boat a usable size, shows about
 * a third of the width a laptop does, so the same fraction put the arrows three times as
 * close together and filled the screen with them.
 */
const SPACING = 200

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
  const step = SPACING / camera.pixelsPerMeter
  // A camera with no zoom would step nowhere, and the loop below would never end.
  if (!(step > 0)) return

  ctx.save()
  ctx.lineCap = 'round'

  for (let x = view.min.x + step / 2; x < view.max.x; x += step) {
    for (let y = view.min.y + step / 2; y < view.max.y; y += step) {
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
