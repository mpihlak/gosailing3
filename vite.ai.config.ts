import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * The robot sailors, bundled for node, for the same reason the server is: they are
 * written in the same TypeScript and reach for modules by the same `@/` alias, which
 * node resolves for neither.
 */
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist-ai',
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/apps/ai-player/main.ts') },
  },
})
