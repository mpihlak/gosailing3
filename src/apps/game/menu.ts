import { cleanName, NAME_LIMIT, type OnlineRace, type Sailor } from '@/net'
import { cssColor, escapeHtml } from '@/presentation/ui'

export interface MenuChoices {
  readonly standalone: () => void
  readonly race: (name: string) => void
  readonly watch: () => void
}

/** Where the name she raced under last time is kept, so she types it once. */
const REMEMBERED = 'gosailing.name'

/**
 * The first thing on the screen: sail here against the computer, or join the regatta.
 *
 * The page watches the regatta behind it from the moment it opens, so the race under the
 * card and the fleet listed on it are both live.
 */
export class Menu {
  private readonly field: HTMLInputElement
  private readonly raceButton: HTMLButtonElement
  private readonly network: HTMLElement
  private readonly fleet: HTMLElement
  /** What the fleet list last said, so it is rewritten only when that changes. */
  private listed = ''

  constructor(
    private readonly root: HTMLElement,
    choices: MenuChoices,
  ) {
    this.field = part(root, 'input[name="name"]')
    this.raceButton = part(root, '[data-choice="race"]')
    this.network = part(root, '.network')
    this.fleet = part(root, '.fleet')

    this.field.maxLength = NAME_LIMIT
    this.field.value = remembered()
    this.noteName()
    this.field.addEventListener('input', () => this.noteName())

    root.addEventListener('click', (event) => {
      const choice = (event.target as HTMLElement).closest('button')?.dataset.choice
      if (choice === 'standalone') choices.standalone()
      if (choice === 'network') {
        this.network.hidden = false
        this.field.focus()
      }
      if (choice === 'watch') choices.watch()
    })
    // Race is the form's submit button, so Enter in the name field races as well.
    part<HTMLFormElement>(root, 'form').addEventListener('submit', (event) => {
      event.preventDefault()
      if (this.field.value) choices.race(this.field.value)
    })
  }

  get open(): boolean {
    return this.root.dataset.visible === 'true'
  }

  show(): void {
    this.root.dataset.visible = 'true'
    document.body.dataset.menu = 'open'
  }

  hide(): void {
    this.root.dataset.visible = 'false'
    delete document.body.dataset.menu
  }

  /** Who is in the regatta and what each has scored, as the page watching it was last told. */
  update(race: OnlineRace | undefined): void {
    const listed = fleetMarkup(race)
    if (listed === this.listed) return
    this.listed = listed
    this.fleet.innerHTML = listed
  }

  /**
   * Cleaned as she types, the same way the server will clean it, so what she sees is
   * what the fleet will see and a name that cleans down to nothing cannot race.
   */
  private noteName(): void {
    const name = cleanName(this.field.value)
    if (name !== this.field.value) this.field.value = name
    this.raceButton.disabled = name === ''
    remember(name)
  }
}

function fleetMarkup(race: OnlineRace | undefined): string {
  if (!race) return ''
  if (race.trouble) return '<p>The regatta cannot be reached.</p>'
  if (race.you === undefined) return '<p>Looking for the regatta…</p>'

  // The page watching from behind the menu is in the fleet too, and is not news to her.
  const others = race.fleet.filter((sailor) => sailor.id !== race.you)
  const racers = others
    .filter((sailor) => sailor.role === 'racer')
    .sort((one, two) => scoreOf(two) - scoreOf(one))
  const watchers = others.length - racers.length

  const rows = racers.map(row).join('')
  const table = rows
    ? `<table class="results"><tr><th></th><th></th><th>pts</th></tr>${rows}</table>`
    : '<p>Nobody is racing.</p>'
  const watching = watchers > 0 ? `<p>${watchers} watching</p>` : ''
  return table + watching
}

function row(sailor: Sailor): string {
  const color = cssColor(sailor.color)
  const paint = color ? ` style="color: ${color}"` : ''
  const doing = sailor.waiting ? 'next race' : 'racing'
  return `<tr><td${paint}>●</td><td>${escapeHtml(sailor.name)} <span class="doing">${doing}</span></td><td class="tally">${scoreOf(sailor)}</td></tr>`
}

/** A server older than the score in the fleet list sends none. */
function scoreOf(sailor: Sailor): number {
  return Number.isFinite(sailor.points) ? sailor.points : 0
}

function part<T extends Element>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`the menu is missing ${selector}`)
  return element
}

/** Storage can be refused, in a private window for one. A name to retype is no loss. */
function remembered(): string {
  try {
    return cleanName(localStorage.getItem(REMEMBERED) ?? '')
  } catch {
    return ''
  }
}

function remember(name: string): void {
  try {
    localStorage.setItem(REMEMBERED, name)
  } catch {
    // As above.
  }
}
