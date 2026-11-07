import type { BoatId } from '@/domain/boat'
import type { Standing } from '@/sim'
import { cssColor, escapeHtml } from './text'

/** On the course side of the line at the gun, and owing a return to clear it. */
export const OCS = 'OCS'

/**
 * The board at the foot of the screen: the fleet in order, a line or two of names with
 * the water showing through, and who owes turns or a return, or is out.
 */
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
    overEarly: ReadonlySet<BoatId>,
  ): void {
    // The board changes rarely and the frame is every sixteen milliseconds, so it is
    // rebuilt only when it would look different.
    const key = standings
      .map(
        (s) => `${s.boatId}${s.place}${s.penalties}${s.finished}${s.dnf}${overEarly.has(s.boatId)}`,
      )
      .join('|')
    if (key === this.shown) return
    this.shown = key

    this.root.innerHTML = standings
      .map((standing) => {
        const name = escapeHtml(this.names[standing.boatId] ?? standing.boatId)
        const classes = [
          'crew',
          standing.boatId === playerId ? 'mine' : '',
          standing.finished ? 'home' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const color = cssColor(this.colors[standing.boatId])
        const ocs = overEarly.has(standing.boatId) ? `<span class="ocs">${OCS}</span>` : ''
        const dnf = standing.dnf ? '<span class="ocs">DNF</span>' : ''
        return `<span class="${classes}"><span class="pos">${escapeHtml(standing.place)}</span><span class="who"${color ? ` style="color: ${color}"` : ''}>${name}</span>${ocs}${dnf}${turns(standing.penalties)}</span>`
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
  return `<span class="turns">⚑${penalties > 1 ? `×${escapeHtml(penalties)}` : ''}</span>`
}
