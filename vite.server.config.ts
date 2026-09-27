import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * The regatta server, bundled for node.
 *
 * It is written in the same TypeScript as the rest and reaches for modules by the same
 * `@/` alias, which node resolves for neither. Bundling it here is one config rather than
 * a second toolchain.
 */
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist-server',
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/apps/server/main.ts') },
  },
})
