import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * GitHub Pages serves a project site from a subdirectory, so a built page has to ask for
 * its assets under that path. The dev server keeps serving from the root, where it is
 * the only thing on the host.
 */
const PAGES_BASE = '/gosailing3/'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PAGES_BASE : '/',
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        game: resolve(import.meta.dirname, 'index.html'),
        lab: resolve(import.meta.dirname, 'lab.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/apps/**', 'src/presentation/render/**'],
    },
  },
}))
