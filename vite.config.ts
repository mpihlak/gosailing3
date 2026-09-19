import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
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
})
