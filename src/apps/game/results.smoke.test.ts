// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, vi } from 'vitest'
import type * as Scenario from './scenario'
import { mountPage, overlayText, tapOverlay } from './page.harness'

/**
 * Sails a whole race and taps the card at the end of it.
 *
 * The results card invited a tap for another race and did nothing, because it was the
 * one card that wrote its own markup instead of going through the function that decides
 * what tapping does. On a laptop the R key hid it; on a phone there is no R key and the
 * game simply stopped. Nothing caught it, because no test had ever reached the end of a
 * race through the page.
 *
 * The course is cut down to keep it quick, and both boats are steered by the AI, since
 * the point here is the card and not the sailing.
 */

vi.mock('./scenario', async () => {
  const actual = await vi.importActual<typeof Scenario>('./scenario')
  return {
    ...actual,
    // The game's own race, with a shorter beat and both boats steered by the AI.
    duel: (seed: number | string) => {
      const race = actual.duel(seed)
      return {
        ...race,
        boats: race.boats.map((boat) => ({ ...boat, controller: 'ai' as const })),
        course: { ...race.course, legLength: 200 },
        config: { startSequence: 20 },
      }
    },
  }
})

const overlay = () => document.querySelector<HTMLElement>('#overlay')

beforeAll(async () => {
  const page = mountPage({ width: 900, height: 600 })
  await import('./main')
  tapOverlay()

  // A second of the player's time per frame, which is as much as the runner will catch
  // up in one go, so a frame here is a second of the race.
  for (let second = 1; second <= 900; second += 1) {
    if (overlayText().includes('Results') || !page.frame(second * 1000)) break
  }
})

describe('the end of a race, on the page', () => {
  it('puts the finishing order up', () => {
    expect(overlay()?.dataset.visible).toBe('true')
    expect(overlay()?.textContent).toContain('Results')
    expect(overlay()?.querySelectorAll('.results tr')).toHaveLength(2)
  })

  it('starts another race when the card is tapped, with no keyboard involved', () => {
    tapOverlay()
    expect(overlay()?.dataset.visible).toBe('false')
  })
})
