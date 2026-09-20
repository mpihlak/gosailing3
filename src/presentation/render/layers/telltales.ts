import { clamp, type Degrees, type Seconds } from '@/foundation/units'
import { PALETTE } from '../palette'

/**
 * Telltales on the luff of the headsail. Both streaming aft means she is sailing her best
 * angle; the windward one lifts when she is too high, and the leeward one when she is too
 * low. They are the instrument a sailor actually steers by, which the polar percentage on
 * the panel is not: that says how she is doing, this says which way to move the helm.
 *
 * The angle they are read against is whichever makes the most of the wind she is in — the
 * beat angle going up, the running angle coming down. So they say the same thing on both
 * legs: you are not making your best speed toward the mark, and here is the way to fix it.
 */
export interface TelltaleState {
  /** 0 streaming straight aft, 1 lifted and flogging. */
  readonly windwardLift: number
  readonly leewardLift: number
  /** Which side of the boat is the windward one, which decides the colors. */
  readonly windwardSide: 'port' | 'starboard'
}

/** Degrees either side of the best angle that still count as on it. */
const ON_TARGET: Degrees = 1.5
/** How far past that she has to stray for a telltale to be fully lifted. */
const FULLY_LIFTED_AT: Degrees = 7
/** Beyond this angle to the wind she is coming down rather than going up. */
const RUNNING_BEYOND: Degrees = 90

/** The angle that makes the most of the wind she is in, going up or coming down. */
export function bestAngle(twa: Degrees, beatAngle: Degrees, runAngle: Degrees): Degrees {
  return Math.abs(twa) < RUNNING_BEYOND ? beatAngle : runAngle
}

export function telltalesFor(
  twa: Degrees,
  beatAngle: Degrees,
  runAngle: Degrees,
): TelltaleState {
  // Negative means she is sailing higher than her best angle, positive that she is lower.
  const error = Math.abs(twa) - bestAngle(twa, beatAngle, runAngle)
  const lift = clamp((Math.abs(error) - ON_TARGET) / FULLY_LIFTED_AT, 0, 1)

  return {
    windwardLift: error < 0 ? lift : 0,
    leewardLift: error > 0 ? lift : 0,
    // Positive TWA puts the wind on the port side, which makes port the windward side.
    windwardSide: twa >= 0 ? 'port' : 'starboard',
  }
}

export const PANEL_WIDTH = 140
export const PANEL_HEIGHT = 60
const RIBBON_LENGTH = 46
/**
 * How far a fully lifted telltale swings up from streaming aft.
 *
 * Capped by the panel rather than chosen for looks: the panel now sits under the
 * instruments on a phone, so a ribbon that swings outside it lands in the clock. The
 * flutter carries the rest of the message — a lifted telltale flogs, a streaming one
 * barely stirs.
 */
const LIFT_ANGLE = 32

/**
 * The flutter runs on the player's clock, not the simulation's. The game steps its
 * physics several times faster than real time, and driving the animation from that made
 * the ribbons shiver rather than fly.
 */
const FLUTTER_RATE = 6
/** How far the cloth moves. A streaming telltale stirs; a lifted one flogs. */
const FLUTTER_STREAMING = 2
const FLUTTER_LIFTED = 7

/** Where the panel sits: its top left corner, in pixels from the canvas corner. */
export interface PanelAnchor {
  readonly left: number
  readonly top: number
}

/**
 * `anchor` is measured off the instruments rather than guessed at, so the panel stays
 * lined up with them however the window is sized and however they wrap.
 * `time` is in the player's seconds, since it drives an animation rather than physics.
 */
export function drawTelltales(
  ctx: CanvasRenderingContext2D,
  state: TelltaleState,
  time: Seconds,
  anchor: PanelAnchor,
): void {
  const { left, top } = anchor
  const luffX = left + 28
  const windwardY = top + 28
  const leewardY = top + 47

  ctx.save()

  roundedRect(ctx, left, top, PANEL_WIDTH, PANEL_HEIGHT, 10)
  ctx.fillStyle = 'rgba(8, 28, 44, 0.72)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  // The luff they are tied to.
  ctx.beginPath()
  ctx.moveTo(luffX, top + 16)
  ctx.lineTo(luffX, top + PANEL_HEIGHT - 6)
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
  ctx.lineWidth = 3
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
