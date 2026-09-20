import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import { createSimulation } from '@/sim'
import { createCamera } from '@/presentation/view/camera'
import { drawScene, type SceneView } from './scene'
import { TrailStore } from './layers/boats'
import { PALETTE } from './palette'

/** Every color the frame is painted in, which is enough to tell the layers apart. */
function colorsIn(view: SceneView): string[] {
  const used: string[] = []
  const own: Record<string, unknown> = {}
  const canvas = new Proxy(own, {
    get(target, property: string) {
      if (property in target) return target[property]
      if (property === 'createLinearGradient' || property === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined })
      }
      return () => undefined
    },
    set(target, property: string, value) {
      if (property === 'strokeStyle' || property === 'fillStyle') used.push(String(value))
      target[property] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D

  drawScene(canvas, view)
  return used
}

/** One boat on the given heading, with the wind steady out of the north. */
function sceneWith(heading: number, started: boolean): SceneView {
  const sim = createSimulation({
    name: 'scene',
    seed: 'scene',
    boats: [{ id: 'a', name: 'Alpha', position: vec(0, -200), heading }],
    wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
  })
  return {
    ctx: sim.ctx,
    world: sim.world,
    camera: createCamera({ width: 900, height: 600 }, vec(0, -200), 420),
    trails: new TrailStore(),
    styles: {},
    playerId: 'a',
    started,
    medianWindSpeed: 12,
    beatAngle: 42,
    runAngle: 150,
    // Off: the wisps are drawn through an offscreen canvas, and these tests run without
    // a browser. Nothing here is about the shadows.
    showShadows: false,
    showLaylines: true,
    laylineAngle: 45,
    displayTime: 0,
    panelAnchor: { left: 16, top: 16 },
  }
}

/** Nothing else on the water is painted in these, so they say the panel was drawn. */
const TELLTALE_COLORS: string[] = [PALETTE.telltalePort, PALETTE.telltaleStarboard]

const shows = (view: SceneView) =>
  colorsIn(view).some((color) => TELLTALE_COLORS.includes(color))

describe('the telltales in the scene', () => {
  /*
   * They used to be hidden coming down the line before the gun, on the grounds that
   * there is no mark to be making for and so no best angle to be off. In practice a
   * panel that empties itself is worse than one reading an angle you are not yet sailing
   * for: it looks broken.
   */
  it('are drawn before the gun, on every point of sail', () => {
    for (const heading of [40, 90, 150, -150]) {
      expect(shows(sceneWith(heading, false))).toBe(true)
    }
  })

  it('are drawn once she is racing', () => {
    for (const heading of [40, 150]) {
      expect(shows(sceneWith(heading, true))).toBe(true)
    }
  })

  it('draws none when the boat they would be read from is not in the fleet', () => {
    expect(shows({ ...sceneWith(40, true), playerId: 'nobody' })).toBe(false)
  })
})
