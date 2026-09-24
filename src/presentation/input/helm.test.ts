// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Helm, type HelmCommand } from './helm'

let helm: Helm
let commands: HelmCommand[]

const press = (key: string) =>
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const release = (key: string) =>
  window.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }))

beforeEach(() => {
  commands = []
  helm = new Helm({ onCommand: (command) => commands.push(command) })
  helm.attach(document.createElement('div'))
})

afterEach(() => helm.detach())

describe('steering', () => {
  it('holds the rudder over while the key is down, and centres it on release', () => {
    press('ArrowLeft')
    expect(helm.rudder).toBe(-1)
    release('ArrowLeft')
    expect(helm.rudder).toBe(0)
  })

  it('cancels out when both are held', () => {
    press('ArrowLeft')
    press('ArrowRight')
    expect(helm.rudder).toBe(0)
  })
})

describe('the boost key', () => {
  it('runs while it is held and stops when it is let go', () => {
    expect(helm.boost).toBe(false)
    press('Shift')
    expect(helm.boost).toBe(true)
    release('Shift')
    expect(helm.boost).toBe(false)
  })

  /*
   * A key released while another window has the focus never reaches us, and the race
   * would run away with nothing able to stop it. The steering keys already let go on
   * blur; the boost is kept with them so it does too.
   */
  it('lets go when the window does', () => {
    press('Shift')
    press('ArrowLeft')
    window.dispatchEvent(new window.Event('blur'))
    expect(helm.boost).toBe(false)
    expect(helm.rudder).toBe(0)
  })

  it('does not steer, and is not a command', () => {
    press('Shift')
    expect(helm.rudder).toBe(0)
    expect(commands).toEqual([])
  })

  it('leaves the other keys reachable while it is held', () => {
    // It takes no default, so the keys keep working and so do the browser's own.
    press('Shift')
    press('w')
    press('l')
    expect(commands).toEqual(['toggleShadows', 'toggleLaylines'])
    expect(helm.boost).toBe(true)
  })
})
