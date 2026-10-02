import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * The regatta server, bundled for node.
 *
 * It is written in the same TypeScript as the rest and reaches for modules by the same
 * `@/` alias, which node resolves for neither. Bundling it here is one config rather than
 * a second toolchain.
 *
 * Everything goes in, `ws` included, so what lands on the server is one file that needs
 * nothing installed beside it.
 *
 * `ws` reaches for two native accelerators behind a `try`/`require`, and the fallback it
 * keeps for when they are missing does not survive bundling: the server took a socket,
 * then died on the first frame a client sent with `bufferUtil.unmask is not a function`.
 * The flags below are the ones `ws` itself reads to skip that path, pinned here so the
 * bundle cannot depend on them being set in the environment that runs it. Neither
 * accelerator is installed, so the pure JavaScript path is the one we were using anyway.
 */
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  ssr: { noExternal: true },
  define: {
    'process.env.WS_NO_BUFFER_UTIL': '"1"',
    'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist-server',
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/apps/server/main.ts') },
  },
})
