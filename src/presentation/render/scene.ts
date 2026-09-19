import type { BoatId } from '@/domain/boat'
import type { Mark } from '@/domain/course'
import type { SimContext, WorldState } from '@/sim'
import type { Camera } from '@/presentation/view/camera'
import { drawWater } from './layers/water'
import { drawWindField } from './layers/wind'
import { drawCourse } from './layers/course'
import { drawBoats, type TrailStore } from './layers/boats'

export interface SceneView {
  readonly ctx: SimContext
  readonly world: WorldState
  readonly camera: Camera
  readonly trails: TrailStore
  readonly playerId?: BoatId
  readonly targetMark?: Mark
  readonly started: boolean
  readonly medianWindSpeed: number
  readonly beatAngle: number
}

/**
 * Draw one frame, back to front. Every layer takes a snapshot and a camera and nothing
 * else, so a lab scene can turn any of them off, or draw one on its own.
 */
export function drawScene(canvas: CanvasRenderingContext2D, view: SceneView): void {
  const { ctx, world, camera, trails, playerId, targetMark, started } = view
  const windDirection = ctx.wind.sample(camera.center, world.time).direction

  drawWater(canvas, camera)
  drawWindField(canvas, camera, ctx.wind, world.time, view.medianWindSpeed)
  drawCourse(canvas, {
    course: ctx.course,
    camera,
    windDirection,
    beatAngle: view.beatAngle,
    started,
    ...(targetMark ? { targetMark } : {}),
  })
  drawBoats(canvas, {
    camera,
    boats: world.boats,
    specs: ctx.specs,
    trails,
    ...(playerId ? { playerId } : {}),
  })
}
