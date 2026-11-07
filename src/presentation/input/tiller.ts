import { clamp } from '@/foundation/units'

/**
 * The arc's drawing: the viewBox, the centre of the arc, and how far round it the
 * indicator swings each way.
 */
const VIEW = { width: 300, height: 150 }
const PIVOT = { x: 150, y: 140 }
const RADIUS = 70
const SWING = 55

/**
 * The rudder angle the scale is marked in at hard over. The physics has no rudder
 * angle, only a turn rate at full rudder, so this is a picture of a typical rudder.
 */
const HARD_OVER = 30

/**
 * How far the thumb moves for hard over, in the drawing's units so it scales with the
 * screen the same way. Wider than the arc: a small arc keeps the water clear, and a
 * short throw would be a twitchy helm.
 */
const REACH = 98

/**
 * A tiller for a boat sailed with a thumb.
 *
 * Pull it to one side and she turns that way; hold it there and she keeps turning; let
 * go and it comes back amidships. Unlike an arrow key it gives the whole range between
 * hard over and centred, which the physics has always taken and no input has yet offered:
 * a gentle turn costs less speed than a thrown one.
 *
 * The thumb goes down anywhere in the area and the tiller follows how far it moves
 * across, not where it is, so there is no grip to find first.
 */
export class Tiller {
  private angle = 0
  private indicator: SVGGElement | undefined
  private drawing: SVGSVGElement | undefined
  /** Where the thumb would be with the tiller amidships. */
  private origin = 0

  /** Where the tiller is: -1 hard to port, +1 hard to starboard. */
  get rudder(): number {
    return this.angle
  }

  attach(area: HTMLElement): void {
    area.innerHTML = arcDrawing()
    this.drawing = area.querySelector('svg') ?? undefined
    this.indicator = area.querySelector<SVGGElement>('.indicator') ?? undefined

    const hold = (event: PointerEvent) => {
      area.setPointerCapture(event.pointerId)
      area.classList.add('holding')
      this.origin = event.clientX - this.angle * this.travel()
    }
    const release = () => {
      area.classList.remove('holding')
      this.angle = 0
      this.show()
    }

    area.addEventListener('pointerdown', hold)
    area.addEventListener('pointermove', (event) => {
      if (area.hasPointerCapture(event.pointerId)) this.pullTo(event.clientX)
    })
    area.addEventListener('pointerup', release)
    area.addEventListener('pointercancel', release)
    // A thumb lifted outside the area still lets go of the tiller.
    area.addEventListener('lostpointercapture', release)
  }

  /** How far across the screen the thumb moves to put the helm hard over. */
  private travel(): number {
    const box = this.drawing?.getBoundingClientRect()
    const scale = box ? Math.min(box.width / VIEW.width, box.height / VIEW.height) : 0
    return Math.max(1, REACH * scale)
  }

  private pullTo(clientX: number): void {
    const travel = this.travel()
    const pulled = (clientX - this.origin) / travel
    // Past hard over the thumb drags amidships along with it, so the moment it comes
    // back the helm eases, without first making up the distance it overshot.
    if (pulled > 1) this.origin = clientX - travel
    if (pulled < -1) this.origin = clientX + travel
    this.angle = clamp(pulled, -1, 1)
    this.show()
  }

  private show(): void {
    if (this.indicator) this.indicator.style.transform = `rotate(${this.angle * SWING}deg)`
  }
}

/** A point on a circle round the pivot, at an angle either side of straight up. */
function onCircle(radius: number, degrees: number): { x: number; y: number } {
  const angle = (degrees * Math.PI) / 180
  return { x: PIVOT.x + radius * Math.sin(angle), y: PIVOT.y - radius * Math.cos(angle) }
}

/** The arc marked like a rudder angle scale: a tick every degree, a longer one every five. */
function arcDrawing(): string {
  const from = onCircle(RADIUS, -SWING)
  const to = onCircle(RADIUS, SWING)
  const arc = `M ${from.x} ${from.y} A ${RADIUS} ${RADIUS} 0 0 1 ${to.x} ${to.y}`

  const ticks: string[] = []
  for (let degree = -HARD_OVER; degree <= HARD_OVER; degree++) {
    const major = degree % 5 === 0
    const at = (degree / HARD_OVER) * SWING
    const inner = onCircle(RADIUS + 2, at)
    const outer = onCircle(RADIUS + (major ? 11 : 6), at)
    ticks.push(
      `<line class="${major ? 'major' : 'minor'}" x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" />`,
    )
  }
  const label = (degree: number) => {
    const at = onCircle(RADIUS + 22, (degree / HARD_OVER) * SWING)
    return `<text x="${at.x}" y="${at.y}">${Math.abs(degree)}</text>`
  }
  const top = onCircle(RADIUS, 0)

  return `<svg viewBox="0 0 ${VIEW.width} ${VIEW.height}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <path class="bed" d="${arc}" />
    <path class="arc" d="${arc}" />
    ${ticks.join('')}
    ${label(-HARD_OVER)}${label(0)}${label(HARD_OVER)}
    <g class="indicator" style="transform-origin: ${PIVOT.x}px ${PIVOT.y}px">
      <circle cx="${top.x}" cy="${top.y}" r="8" />
    </g>
  </svg>`
}
