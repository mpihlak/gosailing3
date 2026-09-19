import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { angleDelta, distance, vec } from '@/foundation/geom'
import type { WindSample } from '@/domain/wind'
import { CRUISER_35_SPEC } from './spec'
import { leewayAngle, spawnBoat, stepBoat, tackOf, trueWindAngle } from './physics'
import type { BoatInput, BoatState } from './types'

const WIND: WindSample = { direction: 0, speed: 12 }
const SPEC = CRUISER_35_SPEC
const TICK = 1 / 60

function sail(
  state: BoatState,
  input: BoatInput,
  seconds: number,
  wind: WindSample = WIND,
  dt = TICK,
): BoatState {
  let current = state
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    current = stepBoat(current, input, SPEC, { wind }, dt)
  }
  return current
}

function closeHauled(heading = SPEC.polar.beatAngle(WIND.speed)): BoatState {
  return spawnBoat({ id: 'test', position: vec(0, 0), heading }, SPEC, WIND)
}

describe('trueWindAngle', () => {
  it('is zero head to wind and 180 dead downwind', () => {
    expect(trueWindAngle(0, 0)).toBe(0)
    expect(trueWindAngle(180, 0)).toBe(180)
  })

  it('is positive on port tack, when the wind crosses from the port side', () => {
    expect(trueWindAngle(45, 0)).toBe(45)
    expect(tackOf(trueWindAngle(45, 0))).toBe('port')
    expect(tackOf(trueWindAngle(315, 0))).toBe('starboard')
  })

  it('follows the wind round rather than the compass', () => {
    expect(trueWindAngle(10, 350)).toBe(20)
    expect(trueWindAngle(350, 10)).toBe(-20)
  })
})

describe('speed', () => {
  it('settles at the polar speed on a steady heading', () => {
    const settled = sail(spawnBoat({ id: 'a', position: vec(0, 0), heading: 90 }, SPEC, WIND), { rudder: 0 }, 120)
    expect(settled.speed).toBeCloseTo(SPEC.polar.boatSpeed(90, WIND.speed), 3)
  })

  it('accelerates from a standstill and converges from below', () => {
    let boat: BoatState = { ...closeHauled(), speed: 0 }
    const speeds = [boat.speed]
    for (let i = 0; i < 12; i++) {
      boat = sail(boat, { rudder: 0 }, 8) // several acceleration time constants
      speeds.push(boat.speed)
    }
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!)
    }
    expect(boat.speed).toBeCloseTo(SPEC.polar.boatSpeed(boat.twa, WIND.speed), 2)
  })

  it('slows down faster than it speeds up, as a heavy boat does', () => {
    expect(SPEC.decelerationTime).toBeLessThan(SPEC.accelerationTime)
    const fast = sail(spawnBoat({ id: 'a', position: vec(0, 0), heading: 110 }, SPEC, WIND), { rudder: 0 }, 60)
    const luffing: BoatState = { ...fast, heading: 10, twa: 10 }
    const afterFive = sail(luffing, { rudder: 0 }, 5)
    expect(afterFive.speed).toBeLessThan(fast.speed * 0.75)
  })

  it('cannot make progress to windward pointing straight at the wind', () => {
    const inIrons = sail({ ...closeHauled(), heading: 0, speed: 1 }, { rudder: 0 }, 60)
    expect(inIrons.speed).toBeLessThan(0.5)
  })
})

describe('steering', () => {
  it('turns toward the rudder and stops at the maximum rate', () => {
    const turning = sail(closeHauled(), { rudder: 1 }, 5)
    expect(turning.turnRate).toBeGreaterThan(0)
    expect(turning.turnRate).toBeLessThanOrEqual(SPEC.maxTurnRate + 1e-9)
  })

  it('answers the helm slowly when the boat has no way on', () => {
    const drifting: BoatState = { ...closeHauled(), speed: 0 }
    const moving = closeHauled()
    const turnedWhileStopped = Math.abs(
      angleDelta(drifting.heading, sail(drifting, { rudder: 1 }, 3).heading),
    )
    const turnedWhileSailing = Math.abs(
      angleDelta(moving.heading, sail(moving, { rudder: 1 }, 3).heading),
    )
    expect(turnedWhileStopped).toBeLessThan(turnedWhileSailing / 2)
  })

  it('ignores rudder beyond the stops', () => {
    const hardOver = sail(closeHauled(), { rudder: 1 }, 5)
    const beyond = sail(closeHauled(), { rudder: 50 }, 5)
    expect(beyond.heading).toBeCloseTo(hardOver.heading, 9)
  })
})

describe('tacking', () => {
  it('costs speed and takes time to recover', () => {
    const beatAngle = SPEC.polar.beatAngle(WIND.speed)
    let boat = sail(closeHauled(beatAngle), { rudder: 0 }, 90)
    const beforeTack = boat.speed

    // Put the helm down until she comes through onto the other tack.
    let slowest = boat.speed
    for (let i = 0; i < 60 * 30; i++) {
      boat = stepBoat(boat, { rudder: -1 }, SPEC, { wind: WIND }, TICK)
      slowest = Math.min(slowest, boat.speed)
      if (boat.twa < -beatAngle) break
    }
    expect(slowest).toBeLessThan(beforeTack * 0.8)

    const recovered = sail(boat, { rudder: 0 }, 90)
    expect(recovered.speed).toBeGreaterThan(beforeTack * 0.98)
  })

  it('punishes a helm thrown hard over more than a smooth turn', () => {
    const start = sail(closeHauled(90), { rudder: 0 }, 60)
    const hard = sail(start, { rudder: 1 }, 4)
    const gentle = sail(start, { rudder: 0.25 }, 4)
    // Compare at the same point of turn, not the same time.
    expect(Math.abs(angleDelta(start.heading, hard.heading))).toBeGreaterThan(
      Math.abs(angleDelta(start.heading, gentle.heading)),
    )
    expect(hard.speed).toBeLessThan(gentle.speed)
  })
})

describe('leeway', () => {
  it('pushes the boat to leeward on both tacks', () => {
    const port = leewayAngle(45, 6, WIND, SPEC)
    const starboard = leewayAngle(-45, 6, WIND, SPEC)
    expect(port).toBeGreaterThan(0) // wind from port pushes her to starboard
    expect(starboard).toBeCloseTo(-port)
  })

  it('is largest close-hauled and negligible downwind', () => {
    const upwind = Math.abs(leewayAngle(45, 6, WIND, SPEC))
    const reaching = Math.abs(leewayAngle(90, 7, WIND, SPEC))
    const running = Math.abs(leewayAngle(170, 6, WIND, SPEC))
    expect(upwind).toBeGreaterThan(reaching)
    expect(running).toBeLessThan(0.3)
    expect(upwind).toBeLessThan(8) // still a plausible number of degrees
  })

  it('grows when the boat is slow and the breeze is up', () => {
    const slow = Math.abs(leewayAngle(45, 3, WIND, SPEC))
    const quick = Math.abs(leewayAngle(45, 7, WIND, SPEC))
    expect(slow).toBeGreaterThan(quick)

    const breezy = Math.abs(leewayAngle(45, 6, { direction: 0, speed: 20 }, SPEC))
    expect(breezy).toBeGreaterThan(Math.abs(leewayAngle(45, 6, WIND, SPEC)))
  })

  it('makes the boat travel to leeward of where she points', () => {
    const boat = sail(closeHauled(), { rudder: 0 }, 30)
    expect(angleDelta(boat.heading, boat.course)).toBeGreaterThan(0)
    expect(boat.course).not.toBe(boat.heading)
  })
})

describe('integration', () => {
  it('gives the same result for the same inputs', () => {
    const a = sail(closeHauled(), { rudder: 0.3 }, 20)
    const b = sail(closeHauled(), { rudder: 0.3 }, 20)
    expect(a).toEqual(b)
  })

  it('does not depend on the size of the time step when sailing straight', () => {
    const coarse = sail(closeHauled(), { rudder: 0 }, 60, WIND, 1 / 30)
    const fine = sail(closeHauled(), { rudder: 0 }, 60, WIND, 1 / 240)
    expect(distance(coarse.position, fine.position)).toBeLessThan(0.5) // meters over 60s
    expect(coarse.speed).toBeCloseTo(fine.speed, 4)
  })

  it('stays close across time steps while turning', () => {
    const coarse = sail(closeHauled(), { rudder: 0.5 }, 20, WIND, 1 / 30)
    const fine = sail(closeHauled(), { rudder: 0.5 }, 20, WIND, 1 / 240)
    expect(Math.abs(angleDelta(coarse.heading, fine.heading))).toBeLessThan(2)
  })

  it('never produces a non-finite or negative value, whatever it is fed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (rudder, heading, windSpeed, startSpeed) => {
          const wind: WindSample = { direction: 0, speed: windSpeed }
          let boat = spawnBoat({ id: 'p', position: vec(0, 0), heading, speed: startSpeed }, SPEC, wind)
          for (let i = 0; i < 600; i++) {
            boat = stepBoat(boat, { rudder }, SPEC, { wind }, TICK)
          }
          expect(Number.isFinite(boat.position.x)).toBe(true)
          expect(Number.isFinite(boat.position.y)).toBe(true)
          expect(Number.isFinite(boat.heading)).toBe(true)
          expect(boat.speed).toBeGreaterThanOrEqual(0)
          expect(boat.speed).toBeLessThan(20)
          expect(boat.heading).toBeGreaterThanOrEqual(0)
          expect(boat.heading).toBeLessThan(360)
        },
      ),
      { numRuns: 40 },
    )
  })
})
