#!/usr/bin/env node
/**
 * Builds the studio for Django and installs it into the reusable app.
 *
 * Two things have to be right for a Vite bundle to work behind Django:
 *
 *   1. Asset URLs must point at the app's static prefix, not the site root.
 *      That is what `base` does, and it has to be baked in at build time
 *      because the bundler writes it into the module graph.
 *   2. index.html must become a Django template that resolves those URLs
 *      through `{% static %}`. Hardcoding /static/ works until STATIC_URL
 *      changes, a CDN appears, or ManifestStaticFilesStorage re-hashes the
 *      filenames -- at which point the page silently serves nothing.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Django app layout. Everything is namespaced so nothing collides. */
const APP = 'font_studio'
const appRoot = resolve(root, 'server', APP)
const staticRoot = resolve(appRoot, 'static', APP)
const templateRoot = resolve(appRoot, 'templates', APP)

const base = `/static/${APP}/`

console.log(`Building with base ${base}`)
execFileSync('npx', ['vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: base },
})

const dist = resolve(root, 'dist')

// Replace rather than merge: a stale hashed chunk left behind from an
// earlier build is dead weight that Django will happily keep collecting.
rmSync(staticRoot, { recursive: true, force: true })
mkdirSync(staticRoot, { recursive: true })
mkdirSync(templateRoot, { recursive: true })

cpSync(resolve(dist, 'assets'), resolve(staticRoot, 'assets'), { recursive: true })
cpSync(resolve(dist, 'favicon.svg'), resolve(staticRoot, 'favicon.svg'))

// ---------------------------------------------------------------------------
// index.html -> Django template
// ---------------------------------------------------------------------------

const html = readFileSync(resolve(dist, 'index.html'), 'utf8')

/** Rewrites one asset URL into a {% static %} call. */
function toStaticTag(url) {
  if (!url.startsWith(base)) return null
  const relative = url.slice(base.length)
  return `{% static '${APP}/${relative}' %}`
}

let converted = 0
let template = html.replace(
  /(src|href)="([^"]+)"/g,
  (match, attribute, url) => {
    const tag = toStaticTag(url)
    if (!tag) return match
    converted += 1
    return `${attribute}="${tag}"`
  },
)

if (converted === 0) {
  throw new Error(
    `No asset URLs were rewritten. Expected them to start with ${base}; ` +
      'the build may not have picked up VITE_BASE.',
  )
}

// The bundle also resolves chunks and the worker relative to the module that
// imported them, so only the entry points in index.html need rewriting. Any
// remaining absolute reference to the base would break under a CDN, so it is
// worth failing loudly rather than shipping it.
const leftovers = template.match(new RegExp(`(?<!% static ')${base}`, 'g'))
if (leftovers) {
  throw new Error(
    `${leftovers.length} asset URL(s) were left pointing at ${base} directly.`,
  )
}

template = `{% load static %}\n${template}`

// Tell the client where the API lives, if there is one. Rendered by Django
// so the studio works under whatever prefix it was mounted at, and so a
// deployment without the API app simply never offers sign-in.
template = template.replace(
  '<div id="root"></div>',
  '<script>\n' +
    '      window.__FONT_STUDIO__ = { apiRoot: "{{ api_root|escapejs }}" }\n' +
    '    </script>\n' +
    '    <div id="root"></div>',
)

// Django escapes nothing here, but the theme bootstrap script contains
// braces that Django's template engine would try to parse. Wrapping it in
// {% verbatim %} keeps it intact.
template = template.replace(
  /(<script>)([\s\S]*?)(<\/script>)/,
  (match, open, body, close) =>
    body.includes('localStorage')
      ? `${open}{% verbatim %}${body}{% endverbatim %}${close}`
      : match,
)

writeFileSync(resolve(templateRoot, 'app.html'), template)

console.log(`\nInstalled into server/${APP}/`)
console.log(`  templates/${APP}/app.html   (${converted} asset URLs via {% static %})`)
console.log(`  static/${APP}/assets/`)

// Every build produces new content-hashed filenames. Under
// ManifestStaticFilesStorage — which is what runs with DEBUG off — the old
// manifest no longer knows about them, and {% static %} raises rather than
// guessing, so the page 500s. The Dockerfile and Procfile already collect
// after building; this is for anyone running production mode by hand.
console.log(
  '\nIf you are running with DEBUG=0, re-run collectstatic before serving:\n' +
    '  cd server && python manage.py collectstatic --noinput',
)
