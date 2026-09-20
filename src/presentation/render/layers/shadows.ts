import { toRadians } from '@/foundation/geom'
import { hashString } from '@/foundation/rng'
import { clamp, smoothstep, type Degrees, type Seconds } from '@/foundation/units'
import { shadowHalfWidth, shadowReach, type Shadower, type ShadowReach } from '@/domain/wind'
import { isVisible, metersToPixels, worldToScreen, type Camera } from '@/presentation/view/camera'

/** Wisps drawn per boat. Enough to read as haze rather than as a row of dots. */
const WISPS = 130
/** How long a wisp takes to travel the length of the shadow. */
const DRIFT: Seconds = 3.4
/** How far a wisp wanders across the stream as it goes. */
const WANDER = 0.2
/**
 * How strongly they gather down the middle of the stream. One would scatter them evenly
 * and leave the middle looking thin; three drew them up in a line down the centre.
 */
const GATHERING = 1.5
/** How much of one wisp shows. They are meant to read together, not one by one. */
const OPACITY = 0.13

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
  const wisp = softWisp()
  ctx.save()

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

    for (let index = 0; index < WISPS; index++) {
      drawWisp(ctx, wisp, camera, shadower, reach, index, time, aft, forward)
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
  sprite: CanvasImageSource,
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

  // Its place across the stream holds as the stream widens, so the wisps fan out, with a
  // gentle gathering toward the middle.
  const lateral = 2 * seed(shadower, wisp, 'across') - 1
  const offset = Math.sign(lateral) * Math.abs(lateral) ** GATHERING
  const wander = Math.sin(time * 1.7 + phase * Math.PI * 2) * WANDER
  const across = clamp(offset + wander, -1, 1)

  const spread = Math.sqrt(Math.max(0, 1 - fraction * fraction))
  const strength = smoothstep(1 - Math.hypot(fraction, across * spread))
  if (strength <= 0.01) return

  const halfWidth = metersToPixels(camera, shadowHalfWidth(reach, fraction))
  const x = across * spread * halfWidth
  const y = fraction >= 0 ? fraction * aft : fraction * forward

  // They swell as they go, the way anything carried on the wind spreads out, and no two
  // are the same size, so the stream does not read as a row of identical dots.
  const scale = 0.6 + 1.1 * seed(shadower, wisp, 'size')
  const size = Math.max(1.5, metersToPixels(camera, scale * (2.2 + 4 * Math.max(0, fraction))))

  ctx.globalAlpha = strength * OPACITY * (0.55 + 0.9 * seed(shadower, wisp, 'weight'))
  ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2)
}

let sprite: HTMLCanvasElement | undefined

/**
 * One soft blob, drawn once and stamped for every wisp. A hard-edged circle reads as a
 * bubble however faint it is; what makes it look like air is the edge going nowhere.
 */
function softWisp(): CanvasImageSource {
  if (sprite) return sprite

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const paint = canvas.getContext('2d')
  if (!paint) throw new Error('this browser has no 2d canvas context')

  const middle = size / 2
  const haze = paint.createRadialGradient(middle, middle, 0, middle, middle, middle)
  haze.addColorStop(0, 'rgba(183, 203, 212, 0.85)')
  haze.addColorStop(0.35, 'rgba(183, 203, 212, 0.3)')
  haze.addColorStop(1, 'rgba(183, 203, 212, 0)')
  paint.fillStyle = haze
  paint.fillRect(0, 0, size, size)

  sprite = canvas
  return sprite
}
