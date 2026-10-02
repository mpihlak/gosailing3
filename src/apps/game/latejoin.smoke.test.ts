// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { mountPage, bannerText } from './page.harness'

/**
 * A sailor who arrives while a race is being sailed is in the next one, not this one. She
 * is still sent the race so she can watch it.
 *
 * She was shown a blank screen instead: the view went to her own boat, which is not in
 * the water, and every frame threw "the player has no boat" before it drew anything.
 */

const WHO = 'c3'
const SCENARIO = {
  name: 'test',
  seed: 'seed',
  boats: [
    { id: 'c1', name: 'Blue (Ann)', controller: 'human' },
    { id: 'c2', name: 'Red (Bob)', controller: 'human' },
  ],
  course: { legLength: 200, lineLength: 120, startCenter: { x: 0, y: 0 } },
  wind: { direction: 0, speed: 12 },
  config: { startSequence: 60 },
  duration: 2400,
}

const sockets: FakeSocket[] = []

class FakeSocket {
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  constructor(readonly url: string) {
    sockets.push(this)
  }
  addEventListener(kind: string, run: (event: unknown) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), run])
    if (kind === 'open') run({})
  }
  send(): void {}
  close(): void {}
  says(message: unknown): void {
    for (const run of this.listeners.get('message') ?? []) run({ data: JSON.stringify(message) })
  }
}

/** Two boats on the water, far enough apart to be ranked. */
const boatsAt = (y: number) => [
  { id: 'c1', position: { x: 0, y }, heading: 0, speed: 6, twa: 45, tack: 'starboard', trim: 1 },
  { id: 'c2', position: { x: 20, y: y - 30 }, heading: 0, speed: 6, twa: 45, tack: 'starboard', trim: 1 },
]

let page: { frame: (at: number) => boolean }
const errors: unknown[] = []

beforeAll(async () => {
  window.history.replaceState({}, '', '/?server=ws://test&name=Cat')
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  console.error = (...args: unknown[]) => errors.push(args[0])
  page = mountPage({ width: 390, height: 844 })
  await import('./main')

  const socket = sockets[0]!
  socket.says({
    kind: 'welcome',
    you: WHO,
    role: 'racer',
    phase: 'racing',
    fleet: [
      { id: 'c1', name: 'Blue (Ann)', role: 'racer', color: '#4fa3dd', waiting: false },
      { id: 'c2', name: 'Red (Bob)', role: 'racer', color: '#c4655c', waiting: false },
      { id: WHO, name: 'Silver (Cat)', role: 'racer', color: '#9fb6c6', waiting: true },
    ],
  })
  socket.says({ kind: 'racing', scenario: SCENARIO })
  // Two snapshots, so there is something to slide between and a frame to draw.
  socket.says({ kind: 'snapshot', time: 10, boats: boatsAt(100), events: [] })
  page.frame(100)
  socket.says({ kind: 'snapshot', time: 10.05, boats: boatsAt(106), events: [] })
  page.frame(200)
  page.frame(300)
})

describe('arriving while a race is on', () => {
  it('draws the race instead of throwing', () => {
    expect(errors).toEqual([])
  })

  it('shows the boats that are actually sailing', () => {
    const roster = document.querySelector('#standings')?.textContent ?? ''
    expect(roster).toContain('Blue (Ann)')
    expect(roster).toContain('Red (Bob)')
  })

  it('says whose race she is watching, and that she is in the next one', () => {
    expect(bannerText()).toContain('next race')
    expect(bannerText()).toContain('Blue (Ann)')
  })
})

/*
 * The keys and the tap that pause or restart a race at home have nothing to act on in a
 * regatta: the race is sailed on a server and runs whether or not this page is watching.
 * Pausing put a Paused card over a race that carried on underneath, and restarting
 * dropped the sailor into a race against the computer with the socket still open.
 */
describe('the controls that cannot apply to a regatta', () => {
  const press = (key: string) =>
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))

  it('does not put a Paused card over a race that is still running', () => {
    press(' ')
    page.frame(400)
    expect(document.querySelector<HTMLElement>('#overlay')?.dataset.visible).toBe('false')
    expect(bannerText()).toContain('cannot be paused')
  })

  it('stays in the regatta when the restart key is pressed', () => {
    press('r')
    page.frame(500)
    expect(bannerText()).toContain('host')
    // Still drawing the boats the server sent, not a race of its own.
    const roster = document.querySelector('#standings')?.textContent ?? ''
    expect(roster).toContain('Blue (Ann)')
    expect(roster).not.toContain('Red\n')
  })

  it('can put the controls card away again', () => {
    press('h')
    expect(document.querySelector<HTMLElement>('#overlay')?.dataset.visible).toBe('true')
    document
      .querySelector('#overlay')
      ?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }))
    expect(document.querySelector<HTMLElement>('#overlay')?.dataset.visible).toBe('false')
  })
})
