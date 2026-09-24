import type { BoatId } from '@/domain/boat'
import type { Knots } from '@/foundation/units'
import type { Standing } from '@/sim'

/** What the board shows about a boat beyond where she lies in the fleet. */
export interface CrewReading {
  /** What she is sailing for now, in the words the player reads. */
  readonly doing: string
  readonly speed: Knots
}

/** On the course side of the line at the gun, and owing a return to clear it. */
export const OCS = 'OCS'

/** The board at the foot of the screen: who is where, what for, and who owes turns. */
export class StandingsBoard {
  private shown = ''

  constructor(
    private readonly root: HTMLElement,
    private readonly names: Readonly<Record<BoatId, string>>,
    /** The color each boat is drawn in, so the board names them as they look. */
    private readonly colors: Readonly<Record<BoatId, string>> = {},
  ) {}

  update(
    standings: readonly Standing[],
    playerId: BoatId,
    reading: Readonly<Record<BoatId, CrewReading>>,
  ): void {
    this.rebuildIfChanged(standings, playerId, reading)

    /*
     * Speed is written into the cells rather than counted as a reason to rebuild. It
     * changes every frame, and the board is built by replacing its markup wholesale, so
     * including it would throw the board away and make it again sixty times a second.
     */
    for (const standing of standings) {
      const cell = this.root.querySelector(`[data-speed="${standing.boatId}"]`)
      const shown = reading[standing.boatId]?.speed.toFixed(1) ?? ''
      if (cell && cell.textContent !== shown) cell.textContent = shown
    }
  }

  private rebuildIfChanged(
    standings: readonly Standing[],
    playerId: BoatId,
    reading: Readonly<Record<BoatId, CrewReading>>,
  ): void {
    // The rest of the board changes rarely and the frame is every sixteen milliseconds,
    // so it is rebuilt only when it would look different.
    const key = standings
      .map((s) => `${s.boatId}${s.place}${s.penalties}${s.finished}${reading[s.boatId]?.doing ?? ''}`)
      .join('|')
    if (key === this.shown) return
    this.shown = key

    this.root.innerHTML = standings
      .map((standing) => {
        const name = this.names[standing.boatId] ?? standing.boatId
        const says = reading[standing.boatId]?.doing ?? ''
        const classes = [
          'crew',
          standing.boatId === playerId ? 'mine' : '',
          standing.finished ? 'home' : '',
          says === OCS ? 'ocs' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const color = this.colors[standing.boatId]
        return `<div class="${classes}">
          <span class="pos">${standing.place}</span>
          <span class="who"${color ? ` style="color: ${color}"` : ''}>${name}</span>
          <span class="doing">${says}</span>
          <span class="speed" data-speed="${standing.boatId}"></span>
          <span class="pen">${turns(standing.penalties)}</span>
        </div>`
      })
      .join('')
  }
}

/**
 * A red flag against a boat that owes turns, with the count beside it once she owes more
 * than one. Nothing at all when she owes none, so the flag itself is the warning.
 */
function turns(penalties: number): string {
  if (penalties <= 0) return ''
  return `<span class="turns">⚑${penalties > 1 ? `×${penalties}` : ''}</span>`
}
