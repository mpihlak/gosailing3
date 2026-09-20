import type { BoatId } from '@/domain/boat'
import type { Standing } from '@/sim'

/** The board in the corner: who is where, and who owes turns. */
export class StandingsBoard {
  private shown = ''

  constructor(
    private readonly root: HTMLElement,
    private readonly names: Readonly<Record<BoatId, string>>,
    /** The color each boat is drawn in, so the board names them as they look. */
    private readonly colors: Readonly<Record<BoatId, string>> = {},
  ) {}

  update(standings: readonly Standing[], playerId: BoatId): void {
    // The board changes rarely and the frame is every sixteen milliseconds, so it is
    // rebuilt only when it would look different.
    const key = standings.map((s) => `${s.boatId}${s.place}${s.penalties}${s.finished}`).join('|')
    if (key === this.shown) return
    this.shown = key

    this.root.innerHTML = standings
      .map((standing) => {
        const name = this.names[standing.boatId] ?? standing.boatId
        const classes = [
          'crew',
          standing.boatId === playerId ? 'mine' : '',
          standing.finished ? 'home' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const color = this.colors[standing.boatId]
        return `<div class="${classes}">
          <span class="pos">${standing.place}</span>
          <span class="who"${color ? ` style="color: ${color}"` : ''}>${name}</span>
          <span class="pen">${turns(standing.penalties)}</span>
        </div>`
      })
      .join('')
  }
}

/** One dot per turn owed. Nothing at all when she owes none, so it reads as a warning. */
function turns(penalties: number): string {
  if (penalties <= 0) return ''
  return `<span class="turns">${'●'.repeat(Math.min(penalties, 4))}${penalties > 4 ? `+${penalties - 4}` : ''}</span>`
}
