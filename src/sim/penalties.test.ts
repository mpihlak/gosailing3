import { describe, it, expect } from 'vitest'
import { vec, type Vec2 } from '@/foundation/geom'
import { CRUISER_35_SPEC, type BoatState } from '@/domain/boat'
import { windwardLeeward } from '@/domain/course'
import { stepRace, type BoatProgress, type RaceState } from './race'
import type { SimEvent } from './events'

const COURSE = windwardLeeward({
  windDirection: 0,
  legLength: 900,
  lineLength: 400,
  startCenter: vec(0, 0),
})
const SPECS = { a: CRUISER_35_SPEC }

function boatAt(position: Vec2, heading: number): BoatState {
  return { id: 'a', position, heading, speed: 6, turnRate: 0, twa: 45, course: heading, leeway: 0 }
}

function racing(overrides: Partial<BoatProgress> = {}): RaceState {
  const progress: BoatProgress = {
    boatId: 'a',
    status: 'racing',
    stageIndex: 1, // working on the windward mark, well clear of either line
    passedMark: false,
    clearedPreStart: true,
    clearedToFinish: false,
    penalties: 1,
    distanceSailed: 0,
    ...overrides,
  }
  return { phase: 'racing', progress: { a: progress }, finishOrder: [] }
}

/** Turn her through a sequence of headings, staying where she is. */
function turnThrough(start: RaceState, headings: number[], at: Vec2 = vec(0, 400)) {
  let race = start
  const events: SimEvent[] = []
  for (let i = 1; i < headings.length; i++) {
    const result = stepRace(race, {
      course: COURSE,
      specs: SPECS,
      previous: [boatAt(at, headings[i - 1] as number)],
      current: [boatAt(at, headings[i] as number)],
      raceTime: 30,
    })
    race = result.race
    events.push(...result.events)
  }
  return { race, events }
}

const circle = (degrees: number, step = 10): number[] =>
  Array.from({ length: Math.abs(degrees) / step + 1 }, (_, i) => i * step * Math.sign(degrees))

describe('taking a penalty turn', () => {
  it('clears one turn for a full circle', () => {
    const { race, events } = turnThrough(racing(), circle(360))
    expect(race.progress.a?.penalties).toBe(0)
    expect(events).toContainEqual({ kind: 'penaltyCleared', boatId: 'a', remaining: 0 })
  })

  it('goes round either way', () => {
    expect(turnThrough(racing(), circle(-360)).race.progress.a?.penalties).toBe(0)
  })

  it('does not clear it for most of a circle', () => {
    const { race } = turnThrough(racing(), circle(340))
    expect(race.progress.a?.penalties).toBe(1)
    expect(race.progress.a?.penaltyTurn?.peak).toBeCloseTo(340)
  })

  it('clears two turns for two circles without straightening up', () => {
    const { race, events } = turnThrough(racing({ penalties: 2 }), circle(720))
    expect(race.progress.a?.penalties).toBe(0)
    expect(events.filter((event) => event.kind === 'penaltyCleared')).toHaveLength(2)
  })

  it('leaves the second turn outstanding after only one circle', () => {
    const { race } = turnThrough(racing({ penalties: 2 }), circle(360))
    expect(race.progress.a?.penalties).toBe(1)
  })

  it('voids a turn she winds back out of, because it must be one direction', () => {
    const backOut = [...circle(180), 140, 100, 60]
    const { race } = turnThrough(racing(), backOut)
    expect(race.progress.a?.penalties).toBe(1)

    // Winding back the other way starts a fresh turn, and none of the half circle she
    // had already made carries over to it.
    expect(race.progress.a?.penaltyTurn?.direction).toBe(-1)
    expect(Math.abs(race.progress.a?.penaltyTurn?.swept ?? 999)).toBeLessThan(180)
  })

  it('forgives a wobble that does not undo the turn', () => {
    const wobble = [...circle(180), 178, 180, ...circle(360).filter((h) => h > 180)]
    const { race } = turnThrough(racing(), wobble)
    expect(race.progress.a?.penalties).toBe(0)
  })

  it('does not start counting turns for a boat who owes none', () => {
    const { race } = turnThrough(racing({ penalties: 0 }), circle(360))
    expect(race.progress.a?.penaltyTurn).toBeUndefined()
    expect(race.progress.a?.penalties).toBe(0)
  })

  it('passes head to wind and dead downwind on the way round, as the rule asks', () => {
    // A full circle in one direction cannot avoid either, which is why the sweep alone
    // is the test and the tack and the gybe are not looked for separately.
    const headings = circle(360)
    expect(headings).toContain(0) // head to wind in a northerly
    expect(headings).toContain(180) // dead downwind
  })
})

describe('finishing with turns owed', () => {
  const FINISH = 2 // start, mark, finish
  const approach = [vec(0, 40), vec(0, -40)] // down through the line

  function crossTheLine(start: RaceState) {
    const result = stepRace(start, {
      course: COURSE,
      specs: SPECS,
      previous: [boatAt(approach[0] as Vec2, 180)],
      current: [boatAt(approach[1] as Vec2, 180)],
      raceTime: 300,
    })
    return result
  }

  it('turns her away when she crosses owing one', () => {
    const { race, events } = crossTheLine(
      racing({ stageIndex: FINISH, penalties: 1, clearedToFinish: true }),
    )
    expect(events).toContainEqual({ kind: 'finishRefused', boatId: 'a', penalties: 1 })
    expect(race.progress.a?.status).toBe('racing')
    expect(race.progress.a?.place).toBeUndefined()
  })

  it('finishes her when she owes none', () => {
    const { race } = crossTheLine(
      racing({ stageIndex: FINISH, penalties: 0, clearedToFinish: true }),
    )
    expect(race.progress.a?.status).toBe('finished')
    expect(race.progress.a?.place).toBe(1)
  })

  it('makes her come wholly back to the course side after a turn below the line', () => {
    // Refused once, so she is no longer clear to finish. Her bow alone coming back is
    // not coming back: rule 44.2 wants the whole hull on the course side.
    const refused = crossTheLine(racing({ stageIndex: FINISH, penalties: 1, clearedToFinish: true }))
    const cleared: RaceState = {
      ...refused.race,
      progress: { a: { ...(refused.race.progress.a as BoatProgress), penalties: 0 } },
    }
    expect(cleared.progress.a?.clearedToFinish).toBe(false)

    const again = crossTheLine(cleared)
    expect(again.race.progress.a?.status).toBe('racing')
  })

  it('finishes her once she has been wholly back on the course side', () => {
    const backOnTheCourseSide = stepRace(
      racing({ stageIndex: FINISH, penalties: 0, clearedToFinish: false }),
      {
        course: COURSE,
        specs: SPECS,
        previous: [boatAt(vec(0, 90), 180)],
        current: [boatAt(vec(0, 80), 180)],
        raceTime: 300,
      },
    )
    expect(backOnTheCourseSide.race.progress.a?.clearedToFinish).toBe(true)

    const { race } = crossTheLine(backOnTheCourseSide.race)
    expect(race.progress.a?.status).toBe('finished')
  })
})
