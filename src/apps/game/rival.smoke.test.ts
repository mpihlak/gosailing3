// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { vec } from '@/foundation/geom'
import type * as Scenario from './scenario'
import { bannerText, mountPage, tapOverlay } from './page.harness'

/**
 * A rival touches a mark, and the player is told.
 *
 * Nothing on the water shows it: a mark gives way rather than stopping a boat, so she
 * sails through it and sails on, eight per cent slower. The banner and the flag on the
 * board are the whole of the signal, and the banner used to drop every event that named
 * another boat — so a rival could round the course hitting marks and the player would
 * never know why she owed turns.
 */

const MARK = 900

vi.mock('./scenario', async () => {
  const actual = await vi.importActual<typeof Scenario>('./scenario')
  return {
    ...actual,
    duel: (seed: number | string) => ({
      ...actual.duel(seed),
      boats: [
        // Parked well clear, pointing away, so the only news is the rival's.
        { id: actual.PLAYER_ID, name: 'Blue', controller: 'human' as const, position: vec(-400, -400), heading: 200 },
        // Running down onto the mark from upwind, which is an angle she can hold.
        { id: actual.OPPONENT_ID, name: 'Red', controller: 'idle' as const, position: vec(0, MARK + 40), heading: 180 },
      ],
      course: { legLength: MARK, lineLength: 400, startCenter: vec(0, 0) },
      config: { startSequence: 0 },
    }),
  }
})

/** Every banner the game put up, in order, since each one overwrites the last. */
const said: string[] = []

beforeAll(async () => {
  const page = mountPage({ width: 900, height: 600 })
  await import('./main')
  tapOverlay()

  for (let second = 1; second <= 120; second += 1) {
    if (!page.frame(second * 1000)) break
    const banner = bannerText()
    if (banner !== '' && banner !== said[said.length - 1]) said.push(banner)
  }
})

describe('a rival touching a mark', () => {
  it('tells the player, and names her', () => {
    expect(said.filter((line) => line.startsWith('Red'))).toEqual(['Red touched a mark — one turn owed'])
  })

  it('shows the turn she owes on the board', () => {
    const rows = [...document.querySelectorAll('#standings .crew')]
    const red = rows.find((row) => row.textContent?.includes('Red'))
    expect(red?.querySelector('.turns')?.textContent).toBe('⚑')
  })

  it('does not tell the player about the rest of a rival\'s race', () => {
    // Her rounding and her finish are her own business; only the penalty is news.
    expect(said.some((line) => line.includes('Mark rounded'))).toBe(false)
  })
})
