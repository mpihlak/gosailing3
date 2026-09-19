import { describe, it, expect } from 'vitest'
import { vec } from './vec'
import { closestPointOnSegment, distanceToSegment, segmentCrossing, sideOfLine } from './lines'

const startLine = { from: vec(-200, 0), to: vec(200, 0) }

describe('sideOfLine', () => {
  it('separates the two sides of a start line', () => {
    // Line runs west to east, so north of it is to the left of the direction of travel.
    expect(sideOfLine(startLine.from, startLine.to, vec(0, 50))).toBeGreaterThan(0)
    expect(sideOfLine(startLine.from, startLine.to, vec(0, -50))).toBeLessThan(0)
    expect(sideOfLine(startLine.from, startLine.to, vec(0, 0))).toBe(0)
  })
})

describe('closestPointOnSegment', () => {
  it('clamps to the ends rather than extending the line', () => {
    expect(closestPointOnSegment(startLine, vec(500, 30))).toMatchObject({ x: 200, y: 0 })
    expect(closestPointOnSegment(startLine, vec(-500, 30))).toMatchObject({ x: -200, y: 0 })
    expect(closestPointOnSegment(startLine, vec(10, 30))).toMatchObject({ x: 10, y: 0 })
  })

  it('handles a degenerate segment', () => {
    const point = vec(5, 5)
    expect(closestPointOnSegment({ from: point, to: point }, vec(0, 0))).toBe(point)
  })

  it('measures distance to the nearer end when the boat is past the pin', () => {
    expect(distanceToSegment(startLine, vec(203, 4))).toBeCloseTo(5)
  })
})

describe('segmentCrossing', () => {
  it('detects a crossing and reports where on the line it happened', () => {
    const crossing = segmentCrossing(vec(0, -10), vec(0, 10), startLine)
    expect(crossing).not.toBeNull()
    expect(crossing?.point).toMatchObject({ x: 0, y: 0 })
    expect(crossing?.u).toBeCloseTo(0.5) // midway between pin and committee boat
  })

  it('reports the direction so a boat sagging back over the line is distinguishable', () => {
    const forward = segmentCrossing(vec(0, -10), vec(0, 10), startLine)
    const backward = segmentCrossing(vec(0, 10), vec(0, -10), startLine)
    expect(Math.sign(forward!.direction)).toBe(-1) // came from south of the line
    expect(Math.sign(backward!.direction)).toBe(1) // came from north of the line
  })

  it('ignores a path that stops short of the line', () => {
    expect(segmentCrossing(vec(0, -10), vec(0, -1), startLine)).toBeNull()
  })

  it('ignores a crossing beyond the pin end', () => {
    expect(segmentCrossing(vec(260, -10), vec(260, 10), startLine)).toBeNull()
  })

  it('ignores a path running along the line', () => {
    expect(segmentCrossing(vec(-50, 0), vec(50, 0), startLine)).toBeNull()
  })
})
