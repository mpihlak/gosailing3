import { describe, it, expect } from 'vitest'
import { distance, vec } from '@/foundation/geom'
import { createLine, crossedLine, lineBearing, lineBias, lineLength, lineMidpoint, sideOfLine } from './line'
import {
  bearingAroundMark,
  COMMITTEE_BOAT,
  isInZone,
  laylineMargin,
  laylines,
  lineEndBodies,
} from './queries'
import { windwardLeeward } from './layouts'

const pin = vec(-200, 0)
const committee = vec(200, 0)
const windwardMark = vec(0, 1000)
const startLine = createLine('start', 'Start', pin, committee, windwardMark)
const finishLine = createLine('finish', 'Finish', pin, committee, vec(0, -100))

describe('createLine', () => {
  it('points its normal toward the first mark', () => {
    expect(startLine.normal.y).toBeGreaterThan(0)
    expect(finishLine.normal.y).toBeLessThan(0)
  })

  it('measures its own length and middle', () => {
    expect(lineLength(startLine)).toBe(400)
    expect(lineMidpoint(startLine)).toMatchObject({ x: 0, y: 0 })
    expect(lineBearing(startLine)).toBeCloseTo(90) // pin in the west, committee in the east
  })

  it('separates the pre-start side from the course side', () => {
    expect(sideOfLine(startLine, vec(0, 50))).toBeGreaterThan(0)
    expect(sideOfLine(startLine, vec(0, -50))).toBeLessThan(0)
  })
})

describe('crossedLine', () => {
  it('sees a boat start', () => {
    expect(crossedLine(startLine, vec(0, -5), vec(0, 5))).toBe('forward')
  })

  it('sees a boat sag back over the line before the gun', () => {
    expect(crossedLine(startLine, vec(0, 5), vec(0, -5))).toBe('backward')
  })

  it('ignores a boat that stays on one side', () => {
    expect(crossedLine(startLine, vec(0, -50), vec(0, -5))).toBeNull()
  })

  it('ignores a boat that passes outside the committee boat', () => {
    expect(crossedLine(startLine, vec(240, -5), vec(240, 5))).toBeNull()
  })

  it('treats the same water as a finish when crossed the other way', () => {
    expect(crossedLine(finishLine, vec(0, 5), vec(0, -5))).toBe('forward')
    expect(crossedLine(startLine, vec(0, 5), vec(0, -5))).toBe('backward')
  })
})

describe('lineBias', () => {
  it('calls a square line even', () => {
    expect(lineBias(startLine, 0).favored).toBe('even')
  })

  it('favors the committee end when the wind shifts right', () => {
    const bias = lineBias(startLine, 10)
    expect(bias.favored).toBe('committee')
    expect(bias.angle).toBeCloseTo(10, 0)
  })

  it('favors the pin when the wind shifts left', () => {
    const bias = lineBias(startLine, 350)
    expect(bias.favored).toBe('pin')
    expect(bias.angle).toBeCloseTo(10, 0)
  })
})

describe('laylines', () => {
  const [port, starboard] = laylines(windwardMark, 0, 40)

  it('sails at the beat angle either side of the wind', () => {
    expect(port.bearing).toBeCloseTo(40)
    expect(starboard.bearing).toBeCloseTo(320)
  })

  it('extends downwind from the mark, which is where it is drawn', () => {
    expect(port.extends.y).toBeLessThan(0)
    expect(starboard.extends.y).toBeLessThan(0)
  })

  it('turns negative before the layline and positive past it', () => {
    // The starboard layline runs southeast from the mark at (0, 1000), so at 200m up
    // the course it passes through x of about 671.
    expect(laylineMargin(vec(-600, 200), starboard)).toBeLessThan(0)
    expect(laylineMargin(vec(600, 200), starboard)).toBeLessThan(0) // still short of it
    expect(laylineMargin(vec(800, 200), starboard)).toBeGreaterThan(0) // overstood
  })

  it('measures the margin as the perpendicular distance to the layline', () => {
    // 129m beyond the layline along the course, at a beat angle of 40 degrees.
    expect(laylineMargin(vec(800, 200), starboard)).toBeCloseTo(129 * Math.cos((40 * Math.PI) / 180), 0)
  })

  it('follows the wind when it shifts', () => {
    const [shifted] = laylines(windwardMark, 20, 40)
    expect(shifted.bearing).toBeCloseTo(60)
  })
})

describe('bearingAroundMark', () => {
  it('reports where a boat sits relative to the mark', () => {
    expect(bearingAroundMark(vec(0, 0), vec(0, 100))).toBeCloseTo(0) // north of it
    expect(bearingAroundMark(vec(0, 0), vec(100, 0))).toBeCloseTo(90) // east of it
    expect(bearingAroundMark(vec(0, 0), vec(0, -100))).toBeCloseTo(180)
  })
})

describe('isInZone', () => {
  const course = windwardLeeward({ windDirection: 0, legLength: 800, lineLength: 400, startCenter: vec(0, 0) })
  const mark = course.marks[0]!

  it('covers three boat lengths around the mark', () => {
    expect(isInZone(mark, vec(0, 800 - 20), 10.7)).toBe(true)
    expect(isInZone(mark, vec(0, 800 - 60), 10.7)).toBe(false)
  })
})

describe('windwardLeeward', () => {
  const course = windwardLeeward({
    windDirection: 0,
    legLength: 900,
    lineLength: 400,
    startCenter: vec(0, 0),
  })

  it('puts the windward mark upwind of the start', () => {
    expect(course.marks[0]!.position.y).toBeCloseTo(900)
    expect(distance(course.marks[0]!.position, vec(0, 0))).toBeCloseTo(900)
  })

  it('runs start, mark, finish for a single lap', () => {
    expect(course.stages.map((stage) => stage.kind)).toEqual(['start', 'mark', 'finish'])
  })

  it('adds a leeward mark and another beat for a second lap', () => {
    const twoLaps = windwardLeeward({
      windDirection: 0,
      legLength: 900,
      lineLength: 400,
      startCenter: vec(0, 0),
      laps: 2,
    })
    expect(twoLaps.stages.map((stage) => stage.kind)).toEqual(['start', 'mark', 'mark', 'mark', 'finish'])
    expect(twoLaps.marks).toHaveLength(2)
  })

  it('squares the line to the wind, and biases it when asked', () => {
    expect(lineBias(startLineOf(course), 0).favored).toBe('even')
    const biased = windwardLeeward({
      windDirection: 0,
      legLength: 900,
      lineLength: 400,
      startCenter: vec(0, 0),
      lineBias: 8,
    })
    expect(lineBias(startLineOf(biased), 0).favored).toBe('pin')
  })

  it('follows the wind direction when the course is set in a different breeze', () => {
    const easterly = windwardLeeward({
      windDirection: 90,
      legLength: 900,
      lineLength: 400,
      startCenter: vec(0, 0),
    })
    expect(easterly.marks[0]!.position.x).toBeCloseTo(900)
    expect(easterly.marks[0]!.position.y).toBeCloseTo(0)
  })

  it('frames the whole course in its bounds', () => {
    expect(course.bounds.min.y).toBeLessThan(-80)
    expect(course.bounds.max.y).toBeGreaterThan(900)
    expect(course.bounds.min.x).toBeLessThan(-200)
    expect(course.bounds.max.x).toBeGreaterThan(200)
  })
})

function startLineOf(course: ReturnType<typeof windwardLeeward>) {
  const stage = course.stages[0]
  if (stage?.kind !== 'start') throw new Error('expected a start stage')
  return stage.line
}

describe('lineEndBodies', () => {
  const course = windwardLeeward({
    windDirection: 0,
    legLength: 900,
    lineLength: 400,
    startCenter: vec(0, 0),
  })
  const bodies = lineEndBodies(course.stages)

  it('puts something solid at each end of the line', () => {
    expect(bodies.map((body) => body.id).sort()).toEqual(['committee', 'pin'])
  })

  it('places them on the ends of the line itself', () => {
    expect(bodies.find((body) => body.id === 'pin')?.position.x).toBeCloseTo(-200)
    expect(bodies.find((body) => body.id === 'committee')?.position.x).toBeCloseTo(200)
  })

  it('makes the committee boat solid and the pin a buoy', () => {
    expect(bodies.find((body) => body.id === 'committee')?.solid).toBe(true)
    expect(bodies.find((body) => body.id === 'pin')?.solid).toBeUndefined()
    expect(bodies.find((body) => body.id === 'committee')!.radius).toBeGreaterThan(
      bodies.find((body) => body.id === 'pin')!.radius,
    )
  })

  it('gives the committee boat a hull rather than a circle round her middle', () => {
    /*
     * She is a vessel, and a circle is wrong in both directions at once: five meters in
     * every direction is more than twice her half beam, so a boat reaching along the line
     * was flagged for contact with two meters of clear water showing down her side.
     */
    const committee = bodies.find((body) => body.id === 'committee')!
    const { from, to } = committee.centreline!
    expect(committee.radius).toBeCloseTo(COMMITTEE_BOAT.beam / 2)
    // Lying along the line's normal, which is where head to wind points.
    expect(from.x).toBeCloseTo(200)
    expect(to.x).toBeCloseTo(200)
    // The capsule around the centreline is exactly her length.
    expect(Math.hypot(to.x - from.x, to.y - from.y) + COMMITTEE_BOAT.beam).toBeCloseTo(
      COMMITTEE_BOAT.length,
    )
  })

  it('leaves the pin round, because a buoy is', () => {
    expect(bodies.find((body) => body.id === 'pin')?.centreline).toBeUndefined()
  })

  it('reports each end once, though the start and finish share them', () => {
    expect(course.stages.filter((stage) => stage.kind === 'start' || stage.kind === 'finish')).toHaveLength(2)
    expect(bodies).toHaveLength(2)
  })

  it('finds nothing on a course with no lines', () => {
    expect(lineEndBodies([])).toEqual([])
  })
})
