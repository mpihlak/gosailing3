import { describe, it, expect } from 'vitest'
import { vec, type Vec2 } from '@/foundation/geom'
import { CRUISER_35_SPEC, type BoatId, type BoatState } from '@/domain/boat'
import { windwardLeeward, type Course } from '@/domain/course'
import { createRaceState, stepRace, type BoatProgress, type RaceState } from './race'
import type { SimEvent } from './events'

const COURSE: Course = windwardLeeward({
  windDirection: 0,
  legLength: 900,
  lineLength: 400,
  startCenter: vec(0, 0),
})
const MARK = COURSE.marks[0]!.position
const SPECS = { a: CRUISER_35_SPEC, b: CRUISER_35_SPEC }

function boatAt(id: BoatId, position: Vec2, heading = 0): BoatState {
  return { id, position, heading, speed: 6, turnRate: 0, twa: 45, course: heading, leeway: 0 }
}

interface Track {
  readonly id: BoatId
  readonly path: readonly Vec2[]
  readonly heading?: number
}

/** Walk one or more boats along a path, one position per tick, and collect what happens. */
function sail(
  tracks: readonly Track[],
  raceTimeAt: (step: number) => number,
  course: Course = COURSE,
) {
  const ids = tracks.map((track) => track.id)
  let race: RaceState = createRaceState(ids)
  const events: SimEvent[] = []
  const steps = Math.max(...tracks.map((track) => track.path.length))

  for (let i = 1; i < steps; i++) {
    const previous = tracks.map((track) =>
      boatAt(track.id, track.path[Math.min(i - 1, track.path.length - 1)]!, track.heading),
    )
    const current = tracks.map((track) =>
      boatAt(track.id, track.path[Math.min(i, track.path.length - 1)]!, track.heading),
    )
    const result = stepRace(race, {
      course,
      specs: SPECS,
      previous,
      current,
      raceTime: raceTimeAt(i),
    })
    race = result.race
    events.push(...result.events)
  }
  return { race, events }
}

/** A point at a bearing and distance from the windward mark. */
function offMark(bearing: number, radius: number): Vec2 {
  const rad = (bearing * Math.PI) / 180
  return vec(MARK.x + radius * Math.sin(rad), MARK.y + radius * Math.cos(rad))
}

/**
 * A path that rounds the windward mark. Approaching from the southeast and sweeping
 * anticlockwise as seen from the mark leaves it to port, which is the way round a
 * standard course is sailed.
 */
function roundingPath(radius = 40, steps = 48, direction: 1 | -1 = -1): Vec2[] {
  const path: Vec2[] = [offMark(135, 335)]
  for (let i = 0; i <= steps; i++) {
    path.push(offMark(135 + direction * 270 * (i / steps), radius))
  }
  path.push(offMark(225, 335))
  return path
}

describe('the start', () => {
  it('starts a boat that crosses the line after the gun', () => {
    const { race, events } = sail([{ id: 'a', path: [vec(0, -40), vec(0, 40)] }], () => 3)
    expect(events).toContainEqual({ kind: 'boatStarted', boatId: 'a', late: 3 })
    expect(race.progress.a?.status).toBe('racing')
    expect(race.progress.a?.stageIndex).toBe(1)
    expect(race.progress.a?.startTime).toBe(3)
  })

  it('says nothing about where she is before the gun', () => {
    // Over the line, round an end, back again: ordinary pre-start manoeuvring. Being on
    // the course side only matters at the starting signal.
    const { race, events } = sail(
      [{ id: 'a', path: [vec(0, -40), vec(0, 40), vec(260, 40), vec(0, -40)] }],
      () => -10,
    )
    expect(events).toEqual([])
    expect(race.progress.a?.status).toBe('prestart')
  })

  it('crossing the line extension round an end is not being over early', () => {
    // Round the outside of the committee boat while waiting, crossing the line's
    // extension but never the line itself, and back behind it before the gun.
    const roundTheEnd = [vec(0, -60), vec(240, -60), vec(260, 40), vec(240, -60), vec(0, -60)]
    const { events } = sail([{ id: 'a', path: roundTheEnd }], () => -10)
    expect(events).toEqual([])
  })

  it('calls her over early at the gun, and clears her when she returns', () => {
    const { race, events } = sail(
      [{ id: 'a', path: [vec(0, -40), vec(0, 40), vec(0, 40), vec(0, -40)] }],
      (step) => (step < 2 ? -10 : 5),
    )
    expect(events.map((event) => event.kind)).toEqual(['raceStarted', 'overEarly', 'cleared'])
    expect(race.progress.a?.status).toBe('prestart')
    expect(race.progress.a?.stageIndex).toBe(0)
  })

  it('does not let a boat that is over early simply sail on after the gun', () => {
    const { race, events } = sail(
      [{ id: 'a', path: [vec(0, -40), vec(0, 40), vec(0, 200)] }],
      (step) => (step < 2 ? -5 : 5),
    )
    expect(events.map((event) => event.kind)).toEqual(['raceStarted', 'overEarly'])
    expect(race.progress.a?.status).toBe('overEarly')
    expect(race.progress.a?.stageIndex).toBe(0)
  })

  it('lets her start properly once she has gone back and cleared', () => {
    const { race } = sail(
      [{ id: 'a', path: [vec(0, -40), vec(0, 40), vec(0, -40), vec(0, 40)] }],
      (step) => (step < 2 ? -5 : 5),
    )
    expect(race.progress.a?.status).toBe('racing')
  })

  it('does not start a boat that goes by outside the committee boat', () => {
    // She reaches the course side without passing between the marks, so the string of
    // her track would not have passed the starting marks and she has not started. She is
    // not over early either: she was behind the line at the gun, and only went round the
    // end afterwards. She simply has to come back and cross properly.
    const { race, events } = sail([{ id: 'a', path: [vec(260, -40), vec(260, 40), vec(260, 200)] }], () => 3)
    expect(race.progress.a?.stageIndex).toBe(0)
    expect(events.filter((event) => event.kind === 'boatStarted')).toHaveLength(0)
    expect(events.filter((event) => event.kind === 'overEarly')).toHaveLength(0)
  })

  it('calls a boat over early for being on the course side at the gun, however she got there', () => {
    // Round the outside of the committee boat before the gun, never crossing the line.
    const roundTheEnd = [vec(0, -60), vec(240, -60), vec(260, 40), vec(120, 60)]
    const { race, events } = sail([{ id: 'a', path: roundTheEnd }], (step) => (step < 3 ? -10 : 5))
    expect(events).toContainEqual({ kind: 'overEarly', boatId: 'a' })
    expect(race.progress.a?.status).toBe('overEarly')
  })

  it('will not start her from the course side until she has been wholly back behind the line', () => {
    const roundTheEndThenUp = [vec(0, -60), vec(240, -60), vec(260, 40), vec(60, 60), vec(60, 400)]
    const { race } = sail([{ id: 'a', path: roundTheEndThenUp }], (step) => (step < 3 ? -10 : 5))
    expect(race.progress.a?.stageIndex).toBe(0)
  })

  it('starts her once she has returned behind the line and crossed it properly', () => {
    const backAndStart = [
      vec(0, -60), vec(240, -60), vec(260, 40), // round the end, still there at the gun
      vec(200, 40), // over early
      vec(120, -60), vec(60, -60), // wholly behind the line again
      vec(60, -10), vec(60, 40), // and across it
    ]
    const { race, events } = sail([{ id: 'a', path: backAndStart }], (step) => (step < 3 ? -10 : 5))
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['overEarly', 'cleared', 'boatStarted']),
    )
    expect(race.progress.a?.status).toBe('racing')
  })

  it('does not count a bow dipped back over the line as having been behind it', () => {
    // She is over early and reaches down so her bow pokes across, then hardens up. Her
    // hull was never entirely on the pre-start side, so she has not started.
    const overEarly: BoatProgress = {
      boatId: 'a',
      status: 'overEarly',
      stageIndex: 0,
      passedMark: false,
      clearedPreStart: false,
      penalties: 0,
      distanceSailed: 0,
    }
    const race: RaceState = { phase: 'racing', progress: { a: overEarly }, finishOrder: [] }

    // Bow south of the line, stern still north of it, then swinging back to the north.
    const bowDown = { ...boatAt('a', vec(40, 4), 180), twa: 45 }
    const bowUp = { ...boatAt('a', vec(40, 4), 0), twa: 45 }
    const { race: after, events } = stepRace(race, {
      course: COURSE,
      specs: SPECS,
      previous: [bowDown],
      current: [bowUp],
      raceTime: 5,
    })

    expect(events.filter((event) => event.kind === 'boatStarted')).toHaveLength(0)
    expect(after.progress.a?.status).toBe('overEarly')
  })

  it('announces the gun once', () => {
    const { events } = sail(
      [{ id: 'a', path: [vec(0, -200), vec(0, -190), vec(0, -180), vec(0, -170)] }],
      (step) => step - 2.5,
    )
    expect(events.filter((event) => event.kind === 'raceStarted')).toHaveLength(1)
  })
})

describe('mark rounding', () => {
  function startedTrack(path: Vec2[]): Track[] {
    return [{ id: 'a', path: [vec(0, -40), vec(0, 40), ...path] }]
  }

  it('counts a rounding that leaves the mark to port', () => {
    const { race, events } = sail(startedTrack(roundingPath()), () => 5)
    expect(events).toContainEqual({ kind: 'markRounded', boatId: 'a', markId: 'windward' })
    expect(race.progress.a?.stageIndex).toBe(2)
  })

  it('does not count a boat that sails past the mark without rounding it', () => {
    const { race } = sail(
      startedTrack([vec(200, 700), vec(200, 900), vec(200, 1100), vec(200, 1300)]),
      () => 5,
    )
    expect(race.progress.a?.stageIndex).toBe(1)
  })

  it('does not count a rounding the wrong way round', () => {
    const { race } = sail(startedTrack(roundingPath(40, 48, 1)), () => 5)
    expect(race.progress.a?.stageIndex).toBe(1)
  })

  it('ignores rotation accumulated far away from the mark', () => {
    // A full circle 400m from the mark: a tactical disaster, but not a rounding.
    const wideCircle: Vec2[] = Array.from({ length: 40 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 39
      return vec(MARK.x + 400 * Math.sin(angle), MARK.y + 400 * Math.cos(angle))
    })
    const { race } = sail(startedTrack(wideCircle), () => 5)
    expect(race.progress.a?.stageIndex).toBe(1)
  })

  it('forgets a partial sweep once the boat leaves the mark behind', () => {
    const partial = roundingPath().slice(0, 12)
    const { race } = sail(startedTrack([...partial, vec(0, -500), ...roundingPath()]), () => 5)
    expect(race.progress.a?.stageIndex).toBe(2) // one rounding, not two
  })

  it('will not count a boat that goes past on the wrong side', () => {
    // Up the west side of the mark and back down the east: the mark was left to
    // starboard, and this course calls for it to be left to port.
    const wrongSide = [offMark(225, 60), offMark(270, 40), offMark(315, 40), offMark(45, 60)]
    const { race } = sail(startedTrack(wrongSide), () => 5)
    expect(race.progress.a?.stageIndex).toBe(1)
  })

  it('resets when a boat goes past the mark and thinks better of it', () => {
    // East of the mark, up past it, then back down the same side without rounding.
    const bailOut = [offMark(135, 50), offMark(90, 30), offMark(45, 40), offMark(90, 30), offMark(135, 50)]
    const { race } = sail(startedTrack(bailOut), () => 5)
    expect(race.progress.a?.stageIndex).toBe(1)
    expect(race.progress.a?.passedMark).toBe(false)
  })

  it('counts a wide rounding the same as a tight one', () => {
    const wide = [offMark(135, 110), offMark(90, 100), offMark(30, 100), offMark(300, 100), offMark(225, 110)]
    const tight = [offMark(135, 30), offMark(90, 14), offMark(20, 14), offMark(300, 14), offMark(225, 30)]
    expect(sail(startedTrack(wide), () => 5).race.progress.a?.stageIndex).toBe(2)
    expect(sail(startedTrack(tight), () => 5).race.progress.a?.stageIndex).toBe(2)
  })

  it('ignores a boat that crosses the mark line far out on the course', () => {
    const wayOut = [offMark(135, 400), offMark(90, 400), offMark(45, 400), offMark(315, 400)]
    const { race } = sail(startedTrack(wayOut), () => 5)
    expect(race.progress.a?.stageIndex).toBe(1)
  })

  it('will not round a mark for a boat that never started', () => {
    const { race } = sail([{ id: 'a', path: roundingPath() }], () => 5)
    expect(race.progress.a?.stageIndex).toBe(0)
  })
})

describe('the finish', () => {
  const fullRace = (id: BoatId, tail: Vec2[] = []): Track => ({
    id,
    path: [vec(0, -40), vec(0, 40), ...roundingPath(), vec(0, 200), vec(0, 40), vec(0, -40), ...tail],
  })

  it('finishes a boat that comes back down through the line', () => {
    const { race, events } = sail([fullRace('a')], () => 5)
    expect(events).toContainEqual({ kind: 'boatFinished', boatId: 'a', place: 1 })
    expect(race.progress.a?.status).toBe('finished')
    expect(race.phase).toBe('complete')
  })

  it('will not finish a boat that skipped the mark', () => {
    const { race } = sail([{ id: 'a', path: [vec(0, -40), vec(0, 40), vec(0, 200), vec(0, -40)] }], () => 5)
    expect(race.progress.a?.status).toBe('racing')
  })

  it('places boats in the order they cross', () => {
    const slow = fullRace('b')
    const { race } = sail(
      [
        fullRace('a'),
        // The same track, but three ticks behind.
        { id: 'b', path: [slow.path[0]!, slow.path[0]!, slow.path[0]!, ...slow.path] },
      ],
      () => 5,
    )
    expect(race.progress.a?.place).toBe(1)
    expect(race.progress.b?.place).toBe(2)
    expect(race.finishOrder).toEqual(['a', 'b'])
  })

  it('records the finish time from the gun, not from the start of the countdown', () => {
    const { race } = sail([fullRace('a')], (step) => step * 2)
    expect(race.progress.a?.finishTime).toBeGreaterThan(0)
  })
})

describe('bookkeeping', () => {
  it('adds up the distance sailed', () => {
    const { race } = sail([{ id: 'a', path: [vec(0, 0), vec(0, 100), vec(100, 100)] }], () => 5)
    expect(race.progress.a?.distanceSailed).toBeCloseTo(200)
  })

  it('notices a tack', () => {
    const race = createRaceState(['a'])
    const onPort = { ...boatAt('a', vec(0, 0)), twa: 40 }
    const onStarboard = { ...boatAt('a', vec(0, 10)), twa: -40 }
    const { events } = stepRace(race, {
      course: COURSE,
      specs: SPECS,
      previous: [onPort],
      current: [onStarboard],
      raceTime: 5,
    })
    expect(events).toContainEqual({ kind: 'tacked', boatId: 'a', from: 'port', to: 'starboard' })
  })

  it('does not call a wobble head to wind a tack', () => {
    const race = createRaceState(['a'])
    const { events } = stepRace(race, {
      course: COURSE,
      specs: SPECS,
      previous: [{ ...boatAt('a', vec(0, 0)), twa: 2 }],
      current: [{ ...boatAt('a', vec(0, 10)), twa: -2 }],
      raceTime: 5,
    })
    expect(events.filter((event) => event.kind === 'tacked')).toHaveLength(0)
  })
})

/**
 * Rule 28.1: a boat sails the course when a string representing her track, drawn taut,
 * passes each mark of the course on the required side and in the correct order, and a
 * mark that does not bound the leg she is sailing has no required side at all.
 */
describe('the string rule at a mark', () => {
  const TWO_LAPS = windwardLeeward({
    windDirection: 0,
    legLength: 900,
    lineLength: 400,
    startCenter: vec(0, 0),
    laps: 2,
  })
  const LEEWARD = TWO_LAPS.marks[1]!.position

  function started(path: Vec2[]): Track[] {
    return [{ id: 'a', path: [vec(0, -40), vec(0, 40), ...path] }]
  }

  it('does not round a mark the boat merely passes on the required side', () => {
    // Up the correct side of the mark and away north. The string passes it on the right
    // side but never goes round it, so the leg is not complete.
    const straightPast = [offMark(135, 60), offMark(90, 30), offMark(45, 40), offMark(20, 200)]
    const { race } = sail(started(straightPast), () => 5)
    expect(race.progress.a?.stageIndex).toBe(1)
    expect(race.progress.a?.passedMark).toBe(true) // half round, and no further
  })

  it('lets a boat who went by on the wrong side come back and do it properly', () => {
    // Wrong side first, which counts for nothing, then a proper rounding. Drawn taut the
    // string unwinds the first excursion and passes the mark correctly.
    const wrongThenRight = [
      offMark(225, 60), offMark(270, 40), offMark(225, 60), // up the wrong side and back
      offMark(135, 50), offMark(90, 30), offMark(30, 30), offMark(300, 30), offMark(225, 60),
    ]
    const { race, events } = sail(started(wrongThenRight), () => 5)
    expect(events.filter((event) => event.kind === 'markRounded')).toHaveLength(1)
    expect(race.progress.a?.stageIndex).toBe(2)
  })

  it('does not undo a rounding if the boat circles the mark again', () => {
    // An extra turn, as a penalty turn would be. The mark is behind her and belongs to a
    // leg she has finished, so it no longer has a required side.
    const roundTwice = [...roundingPath(), ...roundingPath()]
    const { race, events } = sail(started(roundTwice), () => 5)
    expect(events.filter((event) => event.kind === 'markRounded')).toHaveLength(1)
    expect(race.progress.a?.stageIndex).toBe(2)
  })

  it('ignores a mark that does not bound the leg she is sailing', () => {
    // Beating to the windward mark, she passes the leeward mark on what would be the
    // wrong side were she rounding it. It bounds a later leg, so it has no required side
    // here and nothing about it counts.
    const byTheLeewardMark = [
      vec(LEEWARD.x + 30, LEEWARD.y - 40),
      vec(LEEWARD.x + 30, LEEWARD.y + 40),
      vec(0, 300),
    ]
    const { race, events } = sail(started(byTheLeewardMark), () => 5, TWO_LAPS)
    expect(events.filter((event) => event.kind === 'markRounded')).toHaveLength(0)
    expect(race.progress.a?.stageIndex).toBe(1) // still on the first beat
  })

  it('requires the marks in the order the course sets', () => {
    // She rounds the leeward mark first, which is the second mark of the course. It is
    // not the mark bounding her leg, so it does nothing for her.
    const leewardFirst = [
      vec(LEEWARD.x + 60, LEEWARD.y - 60),
      vec(LEEWARD.x + 30, LEEWARD.y),
      vec(LEEWARD.x, LEEWARD.y + 30),
      vec(LEEWARD.x - 30, LEEWARD.y),
      vec(LEEWARD.x - 60, LEEWARD.y - 60),
    ]
    const { race } = sail(started(leewardFirst), () => 5, TWO_LAPS)
    expect(race.progress.a?.stageIndex).toBe(1)
  })

  it('rounds the two marks of a lap in turn', () => {
    // Running down to the leeward mark, leaving it to port means passing to the west of
    // it, then coming back up its eastern side onto the next beat.
    const bothMarks = [
      ...roundingPath(),
      vec(LEEWARD.x - 60, LEEWARD.y + 80),
      vec(LEEWARD.x - 25, LEEWARD.y + 20),
      vec(LEEWARD.x - 15, LEEWARD.y - 25),
      vec(LEEWARD.x + 20, LEEWARD.y - 20),
      vec(LEEWARD.x + 25, LEEWARD.y + 40),
    ]
    const { race, events } = sail(started(bothMarks), () => 5, TWO_LAPS)
    expect(events.filter((event) => event.kind === 'markRounded').map((e) => e.markId)).toEqual([
      'windward',
      'leeward',
    ])
    expect(race.progress.a?.stageIndex).toBe(3) // back onto the second beat
  })
})
