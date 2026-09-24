import { describe, it, expect } from 'vitest'
import { formatRate } from './timescale'

describe('formatRate', () => {
  it('writes a rate the way a player would say it', () => {
    expect(formatRate(1)).toBe('1×')
    expect(formatRate(0.25)).toBe('0.25×')
    expect(formatRate(16)).toBe('16×')
  })

  it('never writes a trailing zero', () => {
    expect(formatRate(2)).toBe('2×')
    expect(formatRate(1.5)).toBe('1.5×')
  })
})
