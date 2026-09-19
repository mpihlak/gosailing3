import { clamp, type Degrees, type Seconds } from '@/foundation/units'
import { PALETTE } from '../palette'

/**
 * Telltales on the luff of the headsail. Both streaming aft means the sail is working;
 * the windward one lifts when the boat is pinched too close to the wind, and the leeward
 * one lifts when she has been allowed to sail too low. They are the instrument a sailor
 * actually steers a beat by, which the polar percentage on the panel is not: that says
 * how she is doing, this says which way to move the helm.
 */
export interface TelltaleState {
  /** 0 streaming straight aft, 1 lifted and flogging. */
  readonly windwardLift: number
  readonly leewardLift: number
  /** Which side of the boat is the windward one, which decides the colors. */
  readonly windwardSide: 'port' | 'starboard'
}

/** Degrees either side of the target angle that still count as on it. */
const ON_TARGET: Degrees = 2.5
/** How far past the deadband the boat has to stray for a telltale to be fully lifted. */
const FULLY_LIFTED_AT: Degrees = 11

/**
 * Whether telltales say anything worth reading. Off the wind the headsail stops being
 * steered by them, so showing a pegged leeward telltale on a run would be noise.
 */
export function telltalesApply(twa: Degrees): boolean {
  return Math.abs(twa) < 90
}

export function telltalesFor(twa: Degrees, beatAngle: Degrees): TelltaleState {
  // Negative means she is pinching, positive means she is footing.
  const error = Math.abs(twa) - beatAngle
  const lift = clamp((Math.abs(error) - ON_TARGET) / FULLY_LIFTED_AT, 0, 1)

  return {
    windwardLift: error < 0 ? lift : 0,
    leewardLift: error > 0 ? lift : 0,
    // Positive TWA puts the wind on the port side, which makes port the windward side.
    windwardSide: twa >= 0 ? 'port' : 'starboard',
  }
}

const PANEL_WIDTH = 164
const PANEL_HEIGHT = 84
const PANEL_TOP = 16
const RIBBON_LENGTH = 62
/** How far a fully lifted telltale swings up from streaming aft. */
const LIFT_ANGLE = 68

/**
 * The flutter runs on the player's clock, not the simulation's. The game steps its
 * physics several times faster than real time, and driving the animation from that made
 * the ribbons shiver rather than fly.
 */
const FLUTTER_RATE = 6
/** How far the cloth moves. A streaming telltale stirs; a lifted one flogs. */
const FLUTTER_STREAMING = 2
const FLUTTER_LIFTED = 7

/**
 * `left` lines the panel up with the instruments below it, and is measured from them
 * rather than guessed at, so the two stay in line at any width.
 * `time` is in the player's seconds, since it drives an animation rather than physics.
 */
export function drawTelltales(
  ctx: CanvasRenderingContext2D,
  state: TelltaleState,
  time: Seconds,
  left: number,
): void {
  const luffX = left + 34
  const windwardY = PANEL_TOP + 26
  const leewardY = PANEL_TOP + 58

  ctx.save()

  roundedRect(ctx, left, PANEL_TOP, PANEL_WIDTH, PANEL_HEIGHT, 10)
  ctx.fillStyle = 'rgba(8, 28, 44, 0.72)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  // The luff they are tied to.
  ctx.beginPath()
  ctx.moveTo(luffX, PANEL_TOP + 14)
  ctx.lineTo(luffX, PANEL_TOP + PANEL_HEIGHT - 14)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 2
  ctx.stroke()

  const portColor = PALETTE.telltalePort
  const starboardColor = PALETTE.telltaleStarboard
  const windwardColor = state.windwardSide === 'port' ? portColor : starboardColor
  const leewardColor = state.windwardSide === 'port' ? starboardColor : portColor

  drawRibbon(ctx, luffX, windwardY, state.windwardLift, windwardColor, time)
  // Offset so the two never beat in step, which reads as a mechanism rather than cloth.
  drawRibbon(ctx, luffX, leewardY, state.leewardLift, leewardColor, time + 0.7)

  ctx.restore()
}

/**
 * One telltale, streaming aft from the luff. A lifted one flutters; a streaming one lies
 * almost still, which is what makes the difference readable out of the corner of an eye.
 */
function drawRibbon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lift: number,
  color: string,
  time: Seconds,
): void {
  const flutter = Math.sin(time * FLUTTER_RATE) * (FLUTTER_STREAMING + lift * FLUTTER_LIFTED)
  const angle = ((-LIFT_ANGLE * lift + flutter * 0.35) * Math.PI) / 180
  const tipX = x + Math.cos(angle) * RIBBON_LENGTH
  const tipY = y + Math.sin(angle) * RIBBON_LENGTH

  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(
    x + Math.cos(angle) * RIBBON_LENGTH * 0.5,
    y + Math.sin(angle) * RIBBON_LENGTH * 0.5 + flutter,
    tipX,
    tipY,
  )
  ctx.strokeStyle = color
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(x, y, 2.5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fill()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}
