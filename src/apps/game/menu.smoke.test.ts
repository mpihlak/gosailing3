// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { DEFAULT_SERVER } from './scenario'
import { mountPage } from './page.harness'

/**
 * The page with nothing in its address: the menu, with the regatta watched behind it.
 */

const opened: FakeSocket[] = []

class FakeSocket {
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  readonly sent: string[] = []
  closed = false
  constructor(readonly url: string) {
    opened.push(this)
  }
  addEventListener(kind: string, run: (event: unknown) => void): void {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), run])
    if (kind === 'open') run({})
  }
  send(text: string): void {
    this.sent.push(text)
  }
  close(): void {
    this.closed = true
  }
  says(message: unknown): void {
    for (const run of this.listeners.get('message') ?? []) run({ data: JSON.stringify(message) })
  }
}

const sailor = (id: string, name: string, points: number, role = 'racer') => ({
  id,
  name,
  colorName: name,
  role,
  color: '#4fa3dd',
  waiting: false,
  host: false,
  points,
})

let page: { frame: (at: number) => boolean }
let clock = 0
const menu = () => document.querySelector<HTMLElement>('#menu')!
const field = () => menu().querySelector<HTMLInputElement>('input[name="name"]')!
const button = (choice: string) =>
  menu().querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!

beforeAll(async () => {
  window.history.replaceState({}, '', '/')
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  page = mountPage({ width: 390, height: 844 })
  await import('./main')
})

describe('the menu', () => {
  it('opens over the regatta, watching it without a name', () => {
    expect(menu().dataset.visible).toBe('true')
    expect(opened[0]?.url).toBe(DEFAULT_SERVER)
    expect(JSON.parse(opened[0]!.sent[0]!)).toEqual({ kind: 'join', name: '', role: 'observer' })
  })

  it('lists who is racing, best score first, and leaves out the page itself', () => {
    opened[0]!.says({
      kind: 'welcome',
      you: 'me',
      role: 'observer',
      phase: 'racing',
      fleet: [
        sailor('a', 'Alice', 3),
        sailor('b', 'Bob', 7),
        sailor('me', 'Watcher', 0, 'observer'),
        sailor('w', 'Watcher', 0, 'observer'),
      ],
    })
    button('network').click()
    page.frame((clock += 16))

    const fleet = menu().querySelector('.fleet')!.textContent!
    expect(fleet.indexOf('Bob')).toBeLessThan(fleet.indexOf('Alice'))
    expect(fleet).toContain('7')
    expect(fleet).toContain('1 watching')
  })

  it('will not race without a name, and cleans one as it is typed', () => {
    field().value = ''
    field().dispatchEvent(new window.Event('input'))
    expect(button('race').disabled).toBe(true)

    field().value = 'A n<n>'
    field().dispatchEvent(new window.Event('input'))
    expect(field().value).toBe('Ann')
    expect(button('race').disabled).toBe(false)
  })

  it('races under that name on a connection of its own', () => {
    button('race').click()
    expect(menu().dataset.visible).toBe('false')
    expect(opened[0]!.closed).toBe(true)
    expect(JSON.parse(opened[1]!.sent[0]!)).toEqual({ kind: 'join', name: 'Ann', role: 'racer' })
  })
})

describe('the back button', () => {
  // happy-dom does not walk the history, so the event the browser sends is sent here.
  const back = () => window.dispatchEvent(new window.PopStateEvent('popstate'))
  const joined = (socket: FakeSocket | undefined) => JSON.parse(socket!.sent[0]!)

  it('leaves the race for the menu, and watches the regatta again', () => {
    back()
    expect(menu().dataset.visible).toBe('true')
    expect(opened[1]!.closed).toBe(true)
    expect(joined(opened[2])).toEqual({ kind: 'join', name: '', role: 'observer' })
  })

  it('leaves a race at home for the menu', () => {
    button('standalone').click()
    expect(menu().dataset.visible).toBe('false')
    expect(opened[2]!.closed).toBe(true)
    back()
    expect(menu().dataset.visible).toBe('true')
    expect(joined(opened[3])).toMatchObject({ role: 'observer' })
  })

  it('puts the menu back over a race being watched, on the same connection', () => {
    button('watch').click()
    expect(menu().dataset.visible).toBe('false')
    back()
    expect(menu().dataset.visible).toBe('true')
    expect(opened[3]!.closed).toBe(false)
    expect(opened).toHaveLength(4)
  })
})
