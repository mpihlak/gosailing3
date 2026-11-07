// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { Tiller } from './tiller'

/** Drawn 300 wide, so the arc's scale is one and hard over is about 98 pixels away. */
function tillerOnScreen() {
  const area = document.createElement('div')
  document.body.append(area)
  const tiller = new Tiller()
  tiller.attach(area)
  const svg = area.querySelector('svg')!
  svg.getBoundingClientRect = () => ({ width: 300, height: 150 }) as DOMRect
  let captured = false
  area.setPointerCapture = () => (captured = true)
  area.hasPointerCapture = () => captured
  const at = (kind: string, clientX: number) =>
    area.dispatchEvent(new window.PointerEvent(kind, { clientX, pointerId: 1 }))
  return { tiller, at }
}

describe('the tiller', () => {
  let helm: ReturnType<typeof tillerOnScreen>
  beforeEach(() => {
    helm = tillerOnScreen()
  })

  it('stays amidships where the thumb goes down, wherever that is', () => {
    helm.at('pointerdown', 40)
    expect(helm.tiller.rudder).toBe(0)
  })

  it('follows how far the thumb moves, not where it is', () => {
    helm.at('pointerdown', 250)
    helm.at('pointermove', 201)
    expect(helm.tiller.rudder).toBeCloseTo(-0.5, 1)
  })

  it('eases the moment the thumb comes back from past hard over', () => {
    helm.at('pointerdown', 100)
    helm.at('pointermove', 400)
    expect(helm.tiller.rudder).toBe(1)
    helm.at('pointermove', 351)
    expect(helm.tiller.rudder).toBeCloseTo(0.5, 1)
  })

  it('comes back amidships when the thumb lifts', () => {
    helm.at('pointerdown', 100)
    helm.at('pointermove', 160)
    helm.at('pointerup', 160)
    expect(helm.tiller.rudder).toBe(0)
  })
})
