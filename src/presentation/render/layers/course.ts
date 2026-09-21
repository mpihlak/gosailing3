import { add, scale, toRadians, vectorToBearing, type Vec2 } from '@/foundation/geom'
import type { Degrees } from '@/foundation/units'
import {
  COMMITTEE_BOAT,
  laylines,
  lineMidpoint,
  type Course,
  type Mark,
  type RaceLine,
} from '@/domain/course'
import { metersToPixels, worldToScreen, type Camera } from '@/presentation/view/camera'
import { PALETTE } from '../palette'

export interface CourseView {
  readonly course: Course
  readonly camera: Camera
  readonly windDirection: Degrees
  /** The angle the laylines are drawn at, which is a track over the ground rather than
   * a heading. */
  readonly laylineAngle: Degrees
  readonly showLaylines: boolean
  readonly started: boolean
  /** The mark the player is working toward, drawn with its laylines. */
  readonly targetMark?: Mark
}

export function drawCourse(ctx: CanvasRenderingContext2D, view: CourseView): void {
  const { course, camera, started, targetMark, windDirection, laylineAngle } = view

  if (targetMark && view.showLaylines) {
    drawLaylines(ctx, camera, targetMark, windDirection, laylineAngle)
  }

  const startStage = course.stages.find((stage) => stage.kind === 'start')
  if (startStage?.kind === 'start') {
    drawStartLine(ctx, camera, startStage.line, started)
  }

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

  ctx.save()
  ctx.strokeStyle = started ? PALETTE.startLineOpen : PALETTE.startLine
  ctx.lineWidth = 2
  ctx.setLineDash([8, 6])
  ctx.beginPath()
  ctx.moveTo(pin.x, pin.y)
  const committee = worldToScreen(camera, line.to)
  ctx.lineTo(committee.x, committee.y)
  ctx.stroke()
  ctx.restore()

  drawCommitteeBoat(ctx, camera, line)

  // Both ends of the line are marked the same way, because both ends are the line.
  ctx.fillStyle = PALETTE.mark
  circle(ctx, pin.x, pin.y, 5)
  ctx.fill()
  circle(ctx, committee.x, committee.y, 4)
  ctx.fill()
}

/**
 * The committee boat lies head to wind, as an anchored boat does, which is along the
 * line's normal. Her size and her heading are the ones the simulation hits her with, not
 * a second set that can drift from them. The orange dot on top of her is the end of the
 * line, which is what the boats are actually crossing.
 */
function drawCommitteeBoat(ctx: CanvasRenderingContext2D, camera: Camera, line: RaceLine): void {
  const screen = worldToScreen(camera, line.to)
  const length = Math.max(18, metersToPixels(camera, COMMITTEE_BOAT.length))
  const beam = Math.max(7, metersToPixels(camera, COMMITTEE_BOAT.beam))

  ctx.save()
  ctx.translate(screen.x, screen.y)
  ctx.rotate(toRadians(vectorToBearing(line.normal)))

  ctx.beginPath()
  ctx.moveTo(0, -length / 2)
  ctx.lineTo(beam / 2, -length / 5)
  ctx.lineTo(beam / 2, length / 2.4)
  ctx.quadraticCurveTo(0, length / 2, -beam / 2, length / 2.4)
  ctx.lineTo(-beam / 2, -length / 5)
  ctx.closePath()
  ctx.fillStyle = PALETTE.committee
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = PALETTE.hullOutline
  ctx.stroke()

  // A wheelhouse, so she reads as a vessel rather than a blob at a glance.
  ctx.fillStyle = PALETTE.hullOutline
  ctx.fillRect(-beam / 4, -length / 8, beam / 2, length / 4)
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
  laylineAngle: Degrees,
): void {
  const reach = 2500
  ctx.save()
  ctx.strokeStyle = PALETTE.layline
  ctx.lineWidth = 1
  ctx.setLineDash([10, 10])

  for (const layline of laylines(mark.position, windDirection, laylineAngle)) {
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
