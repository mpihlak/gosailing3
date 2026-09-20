import { toRadians } from '@/foundation/geom'
import type { Degrees } from '@/foundation/units'
import { shadowReach, type Shadower } from '@/domain/wind'
import { isVisible, metersToPixels, worldToScreen, type Camera } from '@/presentation/view/camera'

/**
 * The water a boat takes the wind out of, drawn as the shape the simulation actually
 * uses: hardest at the boat, thinning downwind, with a little of it reaching ahead of
 * her. If you can see the edge it should be the edge that bites.
 */
export function drawShadows(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shadowers: readonly Shadower[],
  windDirection: Degrees,
): void {
  ctx.save()

  for (const shadower of shadowers) {
    const reach = shadowReach(shadower)
    if (!isVisible(camera, shadower.position, reach.aft)) continue

    const screen = worldToScreen(camera, shadower.position)
    const aft = metersToPixels(camera, reach.aft)
    const forward = metersToPixels(camera, reach.forward)
    const halfWidth = metersToPixels(camera, reach.halfWidth)
    if (aft < 2 || halfWidth < 1) continue

    ctx.save()
    ctx.translate(screen.x, screen.y)
    // Turning to the wind direction points screen-up at where the wind comes from, so
    // downwind — where the shadow lies — is below her.
    ctx.rotate(toRadians(windDirection))

    ctx.beginPath()
    ctx.ellipse(0, 0, halfWidth, aft, 0, 0, Math.PI)
    ctx.ellipse(0, 0, halfWidth, forward, 0, Math.PI, Math.PI * 2)
    ctx.closePath()

    const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(aft, halfWidth))
    fade.addColorStop(0, 'rgba(2, 14, 24, 0.34)')
    fade.addColorStop(0.55, 'rgba(2, 14, 24, 0.16)')
    fade.addColorStop(1, 'rgba(2, 14, 24, 0)')
    ctx.fillStyle = fade
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}
