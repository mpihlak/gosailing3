// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { mountPage, overlayText } from './page.harness'

/**
 * The page renders what a server tells it, and which server is a query parameter. So a
 * link to our own page can point it at somebody else's, and everything on the lobby card
 * and the result sheet is then a stranger's to choose.
 *
 * This drives the real page against a server that sends markup in every string it can.
 */

const POISON = '"><img src=x onerror="document.title=\'pwned\'">'

/** The sockets the page opened, so the test can answer them. */
const opened: FakeSocket[] = []

class FakeSocket {
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  readyState = 1
  constructor(readonly url: string) {
    opened.push(this)
  }
  addEventListener(kind: string, run: (event: unknown) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), run])
  }
  send(): void {}
  close(): void {}
  /** What the server says back. */
  says(message: unknown): void {
    for (const run of this.listeners.get('message') ?? []) run({ data: JSON.stringify(message) })
  }
}

let page: { frame: (at: number) => boolean }

beforeAll(async () => {
  window.history.replaceState({}, '', '/?server=ws://hostile.example&name=Ann')
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  page = mountPage({ width: 900, height: 700 })
  await import('./main')
})

describe('a page pointed at a hostile server', () => {
  it('opened the socket the link named', () => {
    expect(opened[0]?.url).toBe('ws://hostile.example')
  })

  it('puts no element of the server making on the lobby card', () => {
    opened[0]!.says({
      kind: 'welcome',
      you: 'me',
      role: 'racer',
      phase: 'lobby',
      fleet: [
        { id: 'me', name: 'Ann', role: 'racer', color: '#4fa3dd', waiting: false },
        { id: POISON, name: POISON, role: 'racer', color: POISON, waiting: false },
      ],
    })
    page.frame(16)

    const overlay = document.querySelector('#overlay')!
    expect(overlay.querySelector('img')).toBeNull()
    expect(document.title).not.toBe('pwned')
    // It is shown, and shown as the text it is.
    expect(overlayText()).toContain(POISON)
  })

  it('puts none on the result sheet either', () => {
    opened[0]!.says({
      kind: 'results',
      places: [{ boatId: POISON, name: POISON, outcome: 'finished', place: POISON, elapsed: 12 }],
    })
    page.frame(32)

    expect(document.querySelector('#overlay')!.querySelector('img')).toBeNull()
    expect(document.title).not.toBe('pwned')
  })
})
