// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import type { Standing } from '@/sim'
import { StandingsBoard } from './standings'
import { cssColor, escapeHtml } from './text'

describe('escapeHtml', () => {
  it('takes the teeth out of the characters that make markup', () => {
    expect(escapeHtml('<svg onload=alert()>')).toBe('&lt;svg onload=alert()&gt;')
    expect(escapeHtml(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d')
  })

  it('leaves an ordinary name alone', () => {
    expect(escapeHtml('Ann')).toBe('Ann')
  })

  // The protocol calls `place` a number. What arrives is whatever was on the wire.
  it('makes a value safe whatever type it claims to be', () => {
    expect(escapeHtml(3)).toBe('3')
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
    expect(escapeHtml('')).toBe('')
  })
})

describe('cssColor', () => {
  it('passes the hex the fleet is painted in', () => {
    for (const hex of ['#4fa3dd', '#FFF', '#0b223380']) expect(cssColor(hex)).toBe(hex)
  })

  it('drops anything that could close the attribute or carry a handler', () => {
    for (const bad of ['red" onmouseover="alert(1)', 'red', 'url(x)', '', 3, null, undefined]) {
      expect(cssColor(bad)).toBeUndefined()
    }
  })
})

/*
 * The server keeps markup out of what it sends, but the page is pointed at a server by a
 * query parameter and renders whatever that one says. So the board trusts none of it:
 * not the name, not the color, not the id the name is filed under.
 */
describe('a board built from a hostile server', () => {
  const standing: Standing = { boatId: 'a', place: 1, penalties: 2, finished: false }

  function render(overrides: { id?: string; name?: string; color?: string }) {
    const boatId = overrides.id ?? 'a'
    const root = document.createElement('div')
    const board = new StandingsBoard(
      root,
      { [boatId]: overrides.name ?? 'Ann' },
      { [boatId]: overrides.color ?? '#4fa3dd' },
    )
    board.update([{ ...standing, boatId }], boatId, { [boatId]: { doing: '', speed: 6 } })
    return root
  }

  it('puts no element of the server making into the page', () => {
    const root = render({ name: '<svg onload=alert()>' })
    expect(root.querySelector('svg')).toBeNull()
    expect(root.textContent).toContain('<svg onload=alert()>')
  })

  it('refuses a color that tries to close the attribute', () => {
    const root = render({ color: 'red" onmouseover="alert(1)' })
    const who = root.querySelector('.who')!
    expect(who.getAttribute('onmouseover')).toBeNull()
    expect(who.getAttribute('style')).toBeNull()
  })

  it('paints a boat in a color that is one', () => {
    const who = render({ color: '#c4655c' }).querySelector('.who')!
    expect(who.getAttribute('style')).toContain('#c4655c')
  })

  it('survives an id that is markup, and still writes her speed', () => {
    const root = render({ id: '"><img src=x onerror=alert(1)>' })
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelectorAll('.crew')).toHaveLength(1)
    expect(root.querySelector('.speed')?.textContent).toBe('6.0')
  })
})
