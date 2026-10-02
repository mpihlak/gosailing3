// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { DEFAULT_SERVER } from './scenario'
import { mountPage, overlayText } from './page.harness'

/**
 * `?network` is the whole of what a player has to type, and on a phone it is the whole of
 * what she can. No name, no server: the page knows the regatta and the server names her.
 */

const opened: FakeSocket[] = []
const sent: string[] = []

class FakeSocket {
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  readyState = 1
  constructor(readonly url: string) {
    opened.push(this)
  }
  addEventListener(kind: string, run: (event: unknown) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), run])
    if (kind === 'open') run({})
  }
  send(text: string): void {
    sent.push(text)
  }
  close(): void {}
  says(message: unknown): void {
    for (const run of this.listeners.get('message') ?? []) run({ data: JSON.stringify(message) })
  }
}

let page: { frame: (at: number) => boolean }

beforeAll(async () => {
  window.history.replaceState({}, '', '/?network&name=Ann')
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  page = mountPage({ width: 390, height: 844 })
  await import('./main')
})

describe('joining with ?network', () => {
  it('goes to the regatta without being told where it is', () => {
    expect(opened[0]?.url).toBe(DEFAULT_SERVER)
  })

  it('reaches it over wss, which is all an https page may open', () => {
    expect(DEFAULT_SERVER.startsWith('wss://')).toBe(true)
  })

  it('passes the name along and invents none of its own', () => {
    expect(JSON.parse(sent[0]!)).toEqual({ kind: 'join', name: 'Ann', role: 'racer' })
  })

  it('shows her what the server called her', () => {
    opened[0]!.says({
      kind: 'welcome',
      you: 'me',
      role: 'racer',
      phase: 'lobby',
      fleet: [
        {
          id: 'me',
          name: 'Blue (Ann)',
          role: 'racer',
          color: '#4fa3dd',
          waiting: false,
          host: true,
        },
      ],
    })
    page.frame(16)
    expect(overlayText()).toContain('Blue (Ann)')
  })

  /*
   * A sailor on a phone never typed a name, so the colour is the only thing telling her
   * which of the boats on the water is hers. She is shown it before anything else.
   */
  it('holds her colour up before the regatta reaches the screen', () => {
    expect(overlayText()).toContain('You are')
    expect(overlayText()).toContain('Blue (Ann)')
    expect(document.querySelector<HTMLElement>('.yours')?.style.color).toBe('#4fa3dd')
  })

  it('moves on to the regatta once the moment has passed', () => {
    page.frame(1200)
    expect(overlayText()).not.toContain('You are')
    expect(overlayText()).toContain('Waiting for another boat')
  })
})
