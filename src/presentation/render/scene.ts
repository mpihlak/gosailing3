import type { BoatId } from '@/domain/boat'
import type { Mark } from '@/domain/course'
import { shadowersIn, windAt, type SimContext, type WorldState } from '@/sim'
import type { Camera } from '@/presentation/view/camera'
import { drawWater } from './layers/water'
import { drawWindField } from './layers/wind'
import { drawShadows } from './layers/shadows'
import { drawCourse } from './layers/course'
import { drawBoats, type BoatStyle, type TrailStore } from './layers/boats'
import {
  drawTelltales,
  telltalesApply,
  telltalesFor,
  type PanelAnchor,
} from './layers/telltales'

export interface SceneView {
  readonly ctx: SimContext
  readonly world: WorldState
  readonly camera: Camera
  readonly trails: TrailStore
  readonly styles: Readonly<Record<BoatId, BoatStyle>>
  /** Whose instruments are on screen. The telltales are read from her boat. */
  readonly playerId?: BoatId
  readonly targetMark?: Mark
  readonly started: boolean
  readonly medianWindSpeed: number
  /** The angles the telltales are read against, from the polar, for either leg. */
  readonly beatAngle: number
  readonly runAngle: number
  /** The angle the laylines are drawn at: a track, which is wider. */
  readonly laylineAngle: number
  /** The player's seconds, for animation. Physics uses the world's own clock. */
  readonly displayTime: number
  /** Where screen furniture sits, measured off the instrument panel. */
  readonly panelAnchor: PanelAnchor
}

/**
 * Draw one frame, back to front. Every layer takes a snapshot and a camera and nothing
 * else, so a lab scene can turn any of them off, or draw one on its own.
 */
export function drawScene(canvas: CanvasRenderingContext2D, view: SceneView): void {
  const { ctx, world, camera, trails, playerId, targetMark, started } = view
  const windDirection = ctx.wind.sample(camera.center, world.time).direction
  const fleet = shadowersIn(ctx, world)

  drawWater(canvas, camera)
  drawShadows(canvas, camera, fleet, windDirection, view.displayTime)
  drawWindField(
    canvas,
    camera,
    (at) => windAt(ctx, world, at),
    view.medianWindSpeed,
  )
  drawCourse(canvas, {
    course: ctx.course,
    camera,
    windDirection,
    laylineAngle: view.laylineAngle,
    started,
    ...(targetMark ? { targetMark } : {}),
  })
  drawBoats(canvas, { camera, boats: world.boats, specs: ctx.specs, trails, styles: view.styles })

  // Screen furniture rather than something on the water, so it goes on last.
  const player = playerId ? world.boats.find((boat) => boat.id === playerId) : undefined
  if (player && telltalesApply(player.twa, started)) {
    drawTelltales(
      canvas,
      telltalesFor(player.twa, view.beatAngle, view.runAngle),
      view.displayTime,
      view.panelAnchor,
    )
  }
}
