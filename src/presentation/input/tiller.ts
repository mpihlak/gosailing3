import { clamp } from '@/foundation/units'

/**
 * A tiller for a boat sailed with a thumb.
 *
 * Pull it to one side and she turns that way; hold it there and she keeps turning; let
 * go and it comes back amidships. Unlike an arrow key it gives the whole range between
 * hard over and centred, which the physics has always taken and no input has yet offered:
 * a gentle turn costs less speed than a thrown one.
 */
export class Tiller {
  private angle = 0
  private grip: HTMLElement | undefined

  /** Where the tiller is: -1 hard to port, +1 hard to starboard. */
  get rudder(): number {
    return this.angle
  }

  attach(bar: HTMLElement): void {
    this.grip = bar.querySelector<HTMLElement>('.grip') ?? undefined

    const hold = (event: PointerEvent) => {
      bar.setPointerCapture(event.pointerId)
      bar.classList.add('holding')
      this.pullTo(bar, event.clientX)
    }
    const release = () => {
      bar.classList.remove('holding')
      this.angle = 0
      this.show()
    }

    bar.addEventListener('pointerdown', hold)
    bar.addEventListener('pointermove', (event) => {
      if (bar.hasPointerCapture(event.pointerId)) this.pullTo(bar, event.clientX)
    })
    bar.addEventListener('pointerup', release)
    bar.addEventListener('pointercancel', release)
    // A thumb lifted outside the bar still lets go of the tiller.
    bar.addEventListener('lostpointercapture', release)
  }

  private pullTo(bar: HTMLElement, clientX: number): void {
    const box = bar.getBoundingClientRect()
    const gripWidth = this.grip?.getBoundingClientRect().width ?? 0
    const travel = Math.max(1, (box.width - gripWidth) / 2)
    this.angle = clamp((clientX - (box.left + box.width / 2)) / travel, -1, 1)
    this.show()
  }

  private show(): void {
    if (!this.grip) return
    const box = this.grip.parentElement?.getBoundingClientRect()
    const travel = box ? Math.max(1, (box.width - this.grip.getBoundingClientRect().width) / 2) : 0
    this.grip.style.transform = `translateX(${this.angle * travel}px)`
  }
}
