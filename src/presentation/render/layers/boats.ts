import { toRadians, type Vec2 } from '@/foundation/geom'
import { clamp, smoothstep, type Degrees, type Seconds } from '@/foundation/units'
import type { BoatId, BoatSpec, BoatState } from '@/domain/boat'
import { metersToPixels, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

/**
 * Wakes are a picture of where a boat has been, not part of the race, so they live with
 * the renderer. Keeping them out of the simulation also keeps snapshots small enough to
 * send over a network.
 */
export class TrailStore {
  private readonly trails = new Map<BoatId, Vec2[]>()
  private lastSample: Seconds = -Infinity

  constructor(
    private readonly interval: Seconds = 0.4,
    private readonly maxPoints = 90,
  ) {}

  record(boats: readonly BoatState[], time: Seconds): void {
    if (time - this.lastSample < this.interval) return
    this.lastSample = time
    for (const boat of boats) {
      const trail = this.trails.get(boat.id) ?? []
      trail.push(boat.position)
      if (trail.length > this.maxPoints) trail.shift()
      this.trails.set(boat.id, trail)
    }
  }

  of(boatId: BoatId): readonly Vec2[] {
    return this.trails.get(boatId) ?? []
  }

  clear(): void {
    this.trails.clear()
    this.lastSample = -Infinity
  }
}

/** How one boat is drawn. Everything that distinguishes a hull on the water is here. */
export interface BoatStyle {
  readonly hull: string
  readonly trail: string
  readonly trailWidth: number
}

const ANONYMOUS: BoatStyle = {
  hull: PALETTE.hullRival,
  trail: PALETTE.trailRival,
  trailWidth: 1.5,
}

export interface BoatView {
  readonly camera: Camera
  readonly boats: readonly BoatState[]
  readonly specs: Readonly<Record<BoatId, BoatSpec>>
  readonly trails: TrailStore
  /** A style per boat. A boat without one is drawn as an anonymous competitor. */
  readonly styles: Readonly<Record<BoatId, BoatStyle>>
}

export function drawBoats(ctx: CanvasRenderingContext2D, view: BoatView): void {
  const { camera, boats, specs, trails, styles } = view

  // Trails first, all of them, so no boat's wake is drawn over another's hull.
  for (const boat of boats) {
    drawTrail(ctx, camera, trails.of(boat.id), styles[boat.id] ?? ANONYMOUS)
  }
  for (const boat of boats) {
    const spec = specs[boat.id]
    if (spec) drawHull(ctx, camera, boat, spec, styles[boat.id] ?? ANONYMOUS)
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  trail: readonly Vec2[],
  style: BoatStyle,
): void {
  if (trail.length < 2) return
  ctx.save()
  ctx.strokeStyle = style.trail
  ctx.lineWidth = style.trailWidth
  ctx.beginPath()
  trail.forEach((point, index) => {
    const screen = worldToScreen(camera, point)
    if (index === 0) ctx.moveTo(screen.x, screen.y)
    else ctx.lineTo(screen.x, screen.y)
  })
  ctx.stroke()
  ctx.restore()
}

function drawHull(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  boat: BoatState,
  spec: BoatSpec,
  style: BoatStyle,
): void {
  const screen = worldToScreen(camera, boat.position)
  const length = Math.max(10, metersToPixels(camera, spec.length))
  const beam = Math.max(4, metersToPixels(camera, spec.beam))

  ctx.save()
  ctx.translate(screen.x, screen.y)
  // Screen-up is north and canvas rotation runs clockwise, so a heading rotates directly.
  ctx.rotate(toRadians(boat.heading))

  ctx.beginPath()
  ctx.moveTo(0, -length / 2)
  ctx.lineTo(beam / 2, -length / 8)
  ctx.lineTo(beam * 0.42, length / 2)
  ctx.lineTo(-beam * 0.42, length / 2)
  ctx.lineTo(-beam / 2, -length / 8)
  ctx.closePath()

  ctx.fillStyle = style.hull
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = PALETTE.hullOutline
  ctx.stroke()

  drawSail(ctx, boat, length)
  ctx.restore()
}

/** Close-hauled, and eased right out on a run. */
const BOOM_CLOSE_HAULED: Degrees = 18
const BOOM_RUNNING: Degrees = 80
/** The boom, as a fraction of the boat's length. */
const BOOM_LENGTH = 0.62
/** Below this angle to the wind she is luffing, and there is no tack to show. */
const LUFFING_WITHIN: Degrees = 12

/**
 * How far the boom is off the centreline, for drawing.
 *
 * Deliberately exaggerated at the top end. A main sheeted properly close-hauled sits
 * within a few degrees of the centreline, which at the size a boat is drawn on screen is
 * a pixel or two and tells the player nothing. Eighteen degrees is wrong as trim and
 * right as a signal: it is the only thing on the boat that shows which tack she is on.
 */
export function boomAngle(twa: Degrees): Degrees {
  const off = Math.abs(twa)
  const eased = clamp((off - 30) / 120, 0, 1)
  const angle = BOOM_CLOSE_HAULED + (BOOM_RUNNING - BOOM_CLOSE_HAULED) * eased
  // Head to wind the sail comes back amidships and flogs: no tack, and none shown.
  return angle * smoothstep(off / LUFFING_WITHIN)
}

/**
 * How far the clew lies off her centreline, to leeward, as a fraction of her length.
 *
 * Worth having a name because it is not the same as the shape she is hit with. Her hull
 * reaches half her beam either side; on a run the boom reaches several times that, over
 * water a rival can sail through without touching anything.
 */
export function boomReach(twa: Degrees): number {
  return BOOM_LENGTH * Math.sin(toRadians(boomAngle(twa)))
}

/** The mainsail, set on the leeward side. It shows which tack a boat is on at a glance. */
function drawSail(ctx: CanvasRenderingContext2D, boat: BoatState, length: number): void {
  const toLeeward = boat.twa >= 0 ? 1 : -1
  const angle = toRadians(boomAngle(boat.twa))
  const mastY = -length / 5
  const boom = length * BOOM_LENGTH

  // In the boat's own frame, forward is negative y and starboard is positive x.
  const clewX = toLeeward * boom * Math.sin(angle)
  const clewY = mastY + boom * Math.cos(angle)

  // The sail bellies out to leeward of the boom rather than lying along it.
  const camber = boom * 0.22
  const controlX = clewX / 2 + toLeeward * camber * Math.cos(angle)
  const controlY = (mastY + clewY) / 2 - camber * Math.sin(angle)

  ctx.beginPath()
  ctx.moveTo(0, mastY)
  ctx.quadraticCurveTo(controlX, controlY, clewX, clewY)
  ctx.strokeStyle = PALETTE.sail
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke()

  // A short mast, so the sail reads as set on something.
  ctx.beginPath()
  ctx.moveTo(0, mastY)
  ctx.lineTo(0, mastY + length * 0.12)
  ctx.lineWidth = 1.5
  ctx.stroke()
}
