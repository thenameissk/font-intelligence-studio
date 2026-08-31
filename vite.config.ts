import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * Serves the local test fixtures at /dev-fonts/* during development only, so
 * `?font=/dev-fonts/ArialBlack.ttf` can load a font on boot without those
 * licensed system fonts ending up in the production build.
 */
function devFonts(): Plugin {
  return {
    name: 'fis-dev-fonts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-fonts', (request, response, next) => {
        const name = (request.url ?? '').replace(/^\//, '').split('?')[0]
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return next()
        try {
          const data = readFileSync(
            fileURLToPath(new URL(`./test-fonts/${name}`, import.meta.url)),
          )
          response.setHeader(
            'Content-Type',
            name.endsWith('.bmp') ? 'image/bmp' : 'font/ttf',
          )
          response.end(data)
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  /**
   * Where the built assets will be served from.
   *
   * Standalone that is the site root. Mounted inside Django it is the app's
   * static prefix, which the Django build script sets. Every asset URL in
   * index.html is written relative to this, so getting it wrong is the usual
   * cause of a blank page behind a framework.
   */
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), devFonts()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
