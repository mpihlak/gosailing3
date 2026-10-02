// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import type { Standing } from '@/sim'
import { StandingsBoard } from './standings'
import { escapeHtml } from './text'

describe('escapeHtml', () => {
  it('takes the teeth out of the characters that make markup', () => {
    expect(escapeHtml('<svg onload=alert()>')).toBe('&lt;svg onload=alert()&gt;')
    expect(escapeHtml(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d')
  })

  it('leaves an ordinary name alone', () => {
    expect(escapeHtml('Ann')).toBe('Ann')
  })
})

/*
 * The server keeps markup out of a name, but the page is pointed at a server by a query
 * parameter and will render whatever that one sends. So the board escapes it as well.
 */
describe('a hostile name on the board', () => {
  const standing: Standing = { boatId: 'a', place: 1, penalties: 0, finished: false }

  it('puts no element of the sailor making into the page', () => {
    const root = document.createElement('div')
    const board = new StandingsBoard(root, { a: '<svg onload=alert()>' })
    board.update([standing], 'a', { a: { doing: '', speed: 0 } })

    expect(root.querySelector('svg')).toBeNull()
    expect(root.textContent).toContain('<svg onload=alert()>')
  })
})
