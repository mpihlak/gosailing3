import { add, scale, type Vec2 } from '@/foundation/geom'
import type { Degrees } from '@/foundation/units'
import { laylines, lineMidpoint, type Course, type Mark, type RaceLine } from '@/domain/course'
import { metersToPixels, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

export interface CourseView {
  readonly course: Course
  readonly camera: Camera
  readonly windDirection: Degrees
  readonly beatAngle: Degrees
  readonly started: boolean
  /** The mark the player is working toward, drawn with its laylines. */
  readonly targetMark?: Mark
}

export function drawCourse(ctx: CanvasRenderingContext2D, view: CourseView): void {
  const { course, camera, started, targetMark, windDirection, beatAngle } = view

  if (targetMark) drawLaylines(ctx, camera, targetMark, windDirection, beatAngle)

  const startStage = course.stages.find((stage) => stage.kind === 'start')
  if (startStage?.kind === 'start') drawStartLine(ctx, camera, startStage.line, started)

  for (const mark of course.marks) drawMark(ctx, camera, mark, mark === targetMark)
  for (const obstacle of course.obstacles) {
    const screen = worldToScreen(camera, obstacle.position)
    ctx.fillStyle = 'rgba(40, 20, 20, 0.6)'
    circle(ctx, screen.x, screen.y, metersToPixels(camera, obstacle.radius))
    ctx.fill()
  }
}

function drawStartLine(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  line: RaceLine,
  started: boolean,
): void {
  const pin = worldToScreen(camera, line.from)
  const committee = worldToScreen(camera, line.to)

  ctx.save()
  ctx.strokeStyle = started ? PALETTE.startLineOpen : PALETTE.startLine
  ctx.lineWidth = 2
  ctx.setLineDash([8, 6])
  ctx.beginPath()
  ctx.moveTo(pin.x, pin.y)
  ctx.lineTo(committee.x, committee.y)
  ctx.stroke()
  ctx.restore()

  // The pin: a small buoy with a flag.
  ctx.fillStyle = PALETTE.mark
  circle(ctx, pin.x, pin.y, 5)
  ctx.fill()

  // The committee boat: a rectangle lying along the line.
  ctx.save()
  ctx.translate(committee.x, committee.y)
  ctx.rotate(Math.atan2(committee.y - pin.y, committee.x - pin.x))
  ctx.fillStyle = PALETTE.committee
  ctx.fillRect(-6, -5, 22, 10)
  ctx.restore()
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  mark: Mark,
  isTarget: boolean,
): void {
  const screen = worldToScreen(camera, mark.position)
  const radius = Math.max(5, metersToPixels(camera, mark.radius))

  if (isTarget) {
    ctx.fillStyle = PALETTE.markRing
    circle(ctx, screen.x, screen.y, radius * 3.5)
    ctx.fill()
  }
  ctx.fillStyle = PALETTE.mark
  circle(ctx, screen.x, screen.y, radius)
  ctx.fill()
}

/**
 * The two courses that fetch the mark without another tack. Drawing them turns the beat
 * from guesswork into a decision about when to cross one.
 */
function drawLaylines(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  mark: Mark,
  windDirection: Degrees,
  beatAngle: Degrees,
): void {
  const reach = 2500
  ctx.save()
  ctx.strokeStyle = PALETTE.layline
  ctx.lineWidth = 1
  ctx.setLineDash([10, 10])

  for (const layline of laylines(mark.position, windDirection, beatAngle)) {
    const start = worldToScreen(camera, layline.origin)
    const end = worldToScreen(camera, add(layline.origin, scale(layline.extends, reach)))
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  }
  ctx.restore()
}

export function startLineMidpoint(course: Course): Vec2 | undefined {
  const stage = course.stages.find((candidate) => candidate.kind === 'start')
  return stage?.kind === 'start' ? lineMidpoint(stage.line) : undefined
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
}
