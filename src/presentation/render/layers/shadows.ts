import { toRadians } from '@/foundation/geom'
import { hashString } from '@/foundation/rng'
import { clamp, smoothstep, type Degrees, type Seconds } from '@/foundation/units'
import { shadowHalfWidth, shadowReach, type Shadower, type ShadowReach } from '@/domain/wind'
import { isVisible, metersToPixels, worldToScreen, type Camera } from '@/presentation/view/camera'

/** Wisps drawn per boat. Enough to read as a stream, few enough to cost nothing. */
const WISPS = 54
/** How long a wisp takes to travel the length of the shadow. */
const DRIFT: Seconds = 3.4
/** How far a wisp wanders across the stream as it goes. */
const WANDER = 0.14

/**
 * The water a boat takes the wind out of, drawn as the dirty air itself: wisps leaving
 * her rig, spreading as they go downwind and thinning out at the edges of it.
 *
 * They fade the way the shadow does — hardest by the boat, nothing at the tips and the
 * sides — because the fading is the same calculation the simulation judges her by.
 */
export function drawShadows(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shadowers: readonly Shadower[],
  windDirection: Degrees,
  time: Seconds,
): void {
  ctx.save()
  ctx.fillStyle = 'rgba(176, 198, 192, 1)'

  for (const shadower of shadowers) {
    const reach = shadowReach(shadower)
    if (!isVisible(camera, shadower.position, reach.aft)) continue

    const aft = metersToPixels(camera, reach.aft)
    const forward = metersToPixels(camera, reach.forward)
    if (aft < 6) continue

    const screen = worldToScreen(camera, shadower.position)
    ctx.save()
    ctx.translate(screen.x, screen.y)
    // Turning to the wind direction points screen-up at where the wind comes from, so
    // downwind — where the dirty air goes — is below her.
    ctx.rotate(toRadians(windDirection))

    for (let wisp = 0; wisp < WISPS; wisp++) {
      drawWisp(ctx, camera, shadower, reach, wisp, time, aft, forward)
    }
    ctx.restore()
  }

  ctx.restore()
}

/** A stable number in [0, 1) for one wisp, so it does not flicker between frames. */
function seed(shadower: Shadower, wisp: number, salt: string): number {
  return hashString(`${shadower.id}:${wisp}:${salt}`) / 0x100000000
}

function drawWisp(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shadower: Shadower,
  reach: ShadowReach,
  wisp: number,
  time: Seconds,
  aft: number,
  forward: number,
): void {
  // Born at her rig and carried downwind, over and over.
  const phase = seed(shadower, wisp, 'phase')
  const carried = (phase + time / DRIFT) % 1
  const fraction = -1 + 2 * carried

  // Its place across the stream holds as the stream widens, so the wisps fan out. Cubed,
  // to gather them down the middle rather than spread them evenly.
  const offset = (2 * seed(shadower, wisp, 'across') - 1) ** 3
  const wander = Math.sin(time * 1.7 + phase * Math.PI * 2) * WANDER
  const across = clamp(offset + wander, -1, 1)

  const spread = Math.sqrt(Math.max(0, 1 - fraction * fraction))
  const strength = smoothstep(1 - Math.hypot(fraction, across * spread))
  if (strength <= 0.01) return

  const halfWidth = metersToPixels(camera, shadowHalfWidth(reach, fraction))
  const x = across * spread * halfWidth
  const y = fraction >= 0 ? fraction * aft : fraction * forward

  // They swell as they go, the way anything carried on the wind spreads out.
  const size = metersToPixels(camera, 1.1 + 2.2 * Math.max(0, fraction))

  ctx.globalAlpha = strength * 0.38
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.6, size), 0, Math.PI * 2)
  ctx.fill()
}
