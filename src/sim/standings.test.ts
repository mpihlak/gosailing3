import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import { createSimulation } from './scenario'
import { standings } from './standings'
import type { WorldState } from './world'

function fleet() {
  return createSimulation({
    name: 'standings',
    seed: 'board',
    boats: [
      { id: 'a', name: 'Alpha', position: vec(-40, -70), heading: 90 },
      { id: 'b', name: 'Bravo', position: vec(40, -70), heading: 90 },
      { id: 'c', name: 'Charlie', position: vec(0, -70), heading: 90 },
    ],
    course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
  })
}

/** Put a boat wherever on the course we need her, without sailing her there. */
function place(world: WorldState, boatId: string, changes: Record<string, unknown>): WorldState {
  const progress = world.race.progress[boatId]
  if (!progress) return world
  return {
    ...world,
    race: { ...world.race, progress: { ...world.race.progress, [boatId]: { ...progress, ...changes } } },
  }
}

describe('standings', () => {
  it('ranks everyone, once each', () => {
    const { ctx, world } = fleet()
    const board = standings(ctx, world)
    expect(board).toHaveLength(3)
    expect(board.map((entry) => entry.place)).toEqual([1, 2, 3])
    expect(new Set(board.map((entry) => entry.boatId)).size).toBe(3)
  })

  it('puts the boat further round the course ahead', () => {
    const { ctx, world } = fleet()
    const board = standings(ctx, place(world, 'b', { stageIndex: 2 }))
    expect(board[0]?.boatId).toBe('b')
  })

  it('splits boats on the same leg by how far they have left to sail', () => {
    const { ctx, world } = fleet()
    // All three on the first beat; Alpha is furthest up the course toward the mark.
    const moved: WorldState = {
      ...world,
      boats: world.boats.map((boat) =>
        boat.id === 'a' ? { ...boat, position: vec(0, 600) } : boat,
      ),
    }
    const board = standings(ctx, place(place(moved, 'a', { stageIndex: 1 }), 'b', { stageIndex: 1 }))
    expect(board[0]?.boatId).toBe('a')
  })

  /** The fleet moved to where the test wants them, all on one stage. */
  function onStage(stageIndex: number, spots: Record<string, { x: number; y: number }>) {
    const { ctx, world } = fleet()
    let moved: WorldState = {
      ...world,
      boats: world.boats.map((boat) => ({ ...boat, position: spots[boat.id] ?? boat.position })),
    }
    for (const id of Object.keys(spots)) moved = place(moved, id, { stageIndex })
    return standings(ctx, moved).map((entry) => entry.boatId)
  }

  it('measures the beat up the course, not across it', () => {
    // Alpha is 100 m out to one side and 100 m short of the mark's height; Bravo is right
    // below it and 130 m short. Straight-line distance would have put Bravo ahead.
    const order = onStage(1, { a: vec(100, 800), b: vec(0, 770) })
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
  })

  it('measures the run to the finish square to the line, not to its middle', () => {
    // Bravo is making for one end, 60 m short of the line; Alpha is 100 m short of its
    // middle. Bravo is nearer finishing.
    const order = onStage(2, { a: vec(0, 100), b: vec(150, 60) })
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'))
  })

  it('puts a boat past the mark ahead of one still coming up to it', () => {
    const { ctx, world } = fleet()
    const moved: WorldState = {
      ...world,
      boats: world.boats.map((boat) =>
        boat.id === 'a'
          ? { ...boat, position: vec(10, 905) }
          : boat.id === 'b'
            ? { ...boat, position: vec(10, 898) }
            : boat,
      ),
    }
    const rounding = place(place(moved, 'a', { stageIndex: 1, passedMark: true }), 'b', {
      stageIndex: 1,
    })
    const order = standings(ctx, rounding).map((entry) => entry.boatId)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
  })

  it('keeps a finished boat ahead of one still racing, whatever her position', () => {
    const { ctx, world } = fleet()
    const home = place(world, 'c', { status: 'finished', place: 1, finishTime: 400, stageIndex: 3 })
    const board = standings(ctx, home)
    expect(board[0]?.boatId).toBe('c')
    expect(board[0]?.finished).toBe(true)
    expect(board[0]?.finishTime).toBe(400)
  })

  it('keeps finishers in the order they crossed', () => {
    const { ctx, world } = fleet()
    const both = place(place(world, 'b', { status: 'finished', place: 1, stageIndex: 3 }), 'a', {
      status: 'finished',
      place: 2,
      stageIndex: 3,
    })
    const board = standings(ctx, both)
    expect(board.slice(0, 2).map((entry) => entry.boatId)).toEqual(['b', 'a'])
  })

  it('carries the turns each boat owes', () => {
    const { ctx, world } = fleet()
    const board = standings(ctx, place(world, 'a', { penalties: 2 }))
    expect(board.find((entry) => entry.boatId === 'a')?.penalties).toBe(2)
    expect(board.find((entry) => entry.boatId === 'b')?.penalties).toBe(0)
  })
})
