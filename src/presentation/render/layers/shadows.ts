import { toRadians } from '@/foundation/geom'
import type { Degrees } from '@/foundation/units'
import { shadowHalfWidth, shadowReach, type Shadower, type ShadowReach } from '@/domain/wind'
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
    const farWidth = metersToPixels(camera, reach.farWidth)
    if (aft < 2 || farWidth < 1) continue

    ctx.save()
    ctx.translate(screen.x, screen.y)
    // Turning to the wind direction points screen-up at where the wind comes from, so
    // downwind — where the shadow lies — is below her.
    ctx.rotate(toRadians(windDirection))

    traceShadow(ctx, camera, reach, aft, forward)

    const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(aft, farWidth))
    fade.addColorStop(0, 'rgba(2, 14, 24, 0.18)')
    fade.addColorStop(0.55, 'rgba(2, 14, 24, 0.08)')
    fade.addColorStop(1, 'rgba(2, 14, 24, 0)')
    ctx.fillStyle = fade
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

/** How finely the outline is walked. Enough that the curve reads as a curve. */
const OUTLINE_STEPS = 28

/**
 * The outline of the disturbed air, drawn from the same numbers the simulation judges it
 * by, so the edge you can see is the edge that bites.
 */
function traceShadow(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  reach: ShadowReach,
  aft: number,
  forward: number,
): void {
  const edge = (fraction: number): { along: number; across: number } => {
    const width = metersToPixels(camera, shadowHalfWidth(reach, fraction))
    return {
      along: fraction >= 0 ? fraction * aft : fraction * forward,
      across: width * Math.sqrt(Math.max(0, 1 - fraction * fraction)),
    }
  }

  ctx.beginPath()
  for (let step = 0; step <= OUTLINE_STEPS; step++) {
    const { along, across } = edge(-1 + (2 * step) / OUTLINE_STEPS)
    if (step === 0) ctx.moveTo(across, along)
    else ctx.lineTo(across, along)
  }
  for (let step = OUTLINE_STEPS; step >= 0; step--) {
    const { along, across } = edge(-1 + (2 * step) / OUTLINE_STEPS)
    ctx.lineTo(-across, along)
  }
  ctx.closePath()
}
