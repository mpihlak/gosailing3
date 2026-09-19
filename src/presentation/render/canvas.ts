import type { Viewport } from '@/presentation/view/camera'

export interface Surface {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly viewport: Viewport
}

/**
 * Size the drawing buffer to the display. Canvas needs the device pixel ratio applied
 * to the buffer and undone in the transform, or everything is soft on a retina screen.
 */
export function resizeSurface(canvas: HTMLCanvasElement): Surface {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight

  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser has no 2d canvas context')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

  return { canvas, ctx, viewport: { width, height } }
}
